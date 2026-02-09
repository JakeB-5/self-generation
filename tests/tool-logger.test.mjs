// Tests for hooks/tool-logger.mjs
// Requires better-sqlite3 and sqlite-vec installed

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

// Override HOME before importing db.mjs
const TEST_HOME = join(tmpdir(), `tool-logger-test-${Date.now()}`);
const SELF_GEN_DIR = join(TEST_HOME, '.self-generation');
mkdirSync(join(SELF_GEN_DIR, 'data'), { recursive: true });
process.env.HOME = TEST_HOME;

// Create default config
writeFileSync(
  join(SELF_GEN_DIR, 'config.json'),
  JSON.stringify({ enabled: true }, null, 2)
);

// Import db.mjs after HOME is set
const db = await import('../lib/db.mjs');

describe('tool-logger hook', () => {
  let conn;

  before(() => {
    conn = db.getDb();
  });

  after(() => {
    try { conn.close(); } catch { /* ignore */ }
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  /**
   * Helper to run hook with stdin and return exit code
   */
  async function runHook(stdinData) {
    return new Promise((resolve) => {
      const proc = spawn('node', ['hooks/tool-logger.mjs'], {
        cwd: '/Users/sungwon/projects/self-generation',
        env: { ...process.env, HOME: TEST_HOME },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      proc.stdin.write(JSON.stringify(stdinData));
      proc.stdin.end();

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d; });
      proc.stderr.on('data', (d) => { stderr += d; });

      proc.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  }

  describe('REQ-DC-201: Record tool_use events', () => {
    it('should record basic tool_use event', async () => {
      const input = {
        tool_name: 'Read',
        tool_input: { file_path: '/src/index.ts' },
        tool_response: 'file contents',
        session_id: 'test-session-1',
        cwd: '/test/project'
      };

      const result = await runHook(input);
      assert.equal(result.code, 0, 'hook should exit 0');

      const events = db.queryEvents({ sessionId: 'test-session-1', type: 'tool_use' });
      assert.equal(events.length, 1);

      const event = events[0];
      assert.equal(event.v, 1);
      assert.equal(event.type, 'tool_use');
      assert.equal(event.tool, 'Read');
      assert.equal(event.success, true);
      assert.equal(event.meta.file, '/src/index.ts');
      assert.ok(event.ts);
      assert.equal(event.sessionId, 'test-session-1');
    });

    it('should map stdin fields correctly', async () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm install express' },
        session_id: 'test-session-2',
        cwd: '/test/app'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'test-session-2' });
      assert.equal(events.length, 1);
      assert.equal(events[0].tool, 'Bash');
      assert.equal(events[0].meta.command, 'npm');
    });
  });

  describe('REQ-DC-202: extractToolMeta', () => {
    it('should extract Bash command (first word only)', async () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm install express --save' },
        session_id: 'bash-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'bash-test' });
      assert.equal(events[0].meta.command, 'npm');
    });

    it('should extract file path for Read', async () => {
      const input = {
        tool_name: 'Read',
        tool_input: { file_path: '/src/utils.ts' },
        session_id: 'read-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'read-test' });
      assert.equal(events[0].meta.file, '/src/utils.ts');
    });

    it('should extract file path for Write', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/output.txt', content: 'data' },
        session_id: 'write-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'write-test' });
      assert.equal(events[0].meta.file, '/output.txt');
    });

    it('should extract file path for Edit', async () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' },
        session_id: 'edit-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'edit-test' });
      assert.equal(events[0].meta.file, '/src/app.ts');
    });

    it('should mask sensitive file paths', async () => {
      const sensitiveFiles = [
        '/app/.env',
        '/config/.env.local',
        '/secrets/credentials.json',
        '/certs/private.key',
        '/ssl/cert.pem',
        '/.ssh/id_rsa'
      ];

      for (const filePath of sensitiveFiles) {
        const input = {
          tool_name: 'Read',
          tool_input: { file_path: filePath },
          session_id: `sensitive-test-${filePath}`,
          cwd: '/test'
        };

        await runHook(input);

        const events = db.queryEvents({ sessionId: `sensitive-test-${filePath}` });
        assert.equal(
          events[0].meta.file,
          '[SENSITIVE_PATH]',
          `should mask ${filePath}`
        );
      }
    });

    it('should extract pattern for Grep', async () => {
      const input = {
        tool_name: 'Grep',
        tool_input: { pattern: 'TODO.*fix' },
        session_id: 'grep-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'grep-test' });
      assert.equal(events[0].meta.pattern, 'TODO.*fix');
    });

    it('should extract pattern for Glob', async () => {
      const input = {
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.ts' },
        session_id: 'glob-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'glob-test' });
      assert.equal(events[0].meta.pattern, '**/*.ts');
    });

    it('should extract agent info for Task', async () => {
      const input = {
        tool_name: 'Task',
        tool_input: { subagent_type: 'executor', model: 'sonnet' },
        session_id: 'task-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'task-test' });
      assert.equal(events[0].meta.agentType, 'executor');
      assert.equal(events[0].meta.model, 'sonnet');
    });

    it('should return empty object for unknown tool', async () => {
      const input = {
        tool_name: 'UnknownTool',
        tool_input: { foo: 'bar' },
        session_id: 'unknown-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'unknown-test' });
      assert.deepEqual(events[0].meta, {});
    });

    it('should return empty object for null toolInput', async () => {
      const input = {
        tool_name: 'Bash',
        tool_input: null,
        session_id: 'null-input-test',
        cwd: '/test'
      };

      await runHook(input);

      const events = db.queryEvents({ sessionId: 'null-input-test' });
      assert.deepEqual(events[0].meta, {});
    });
  });

  describe('REQ-DC-203: Same-tool resolution detection', () => {
    it('should detect Bash error → Bash success resolution', async () => {
      const sessionId = 'same-tool-test';

      // Insert error event
      db.insertEvent({
        v: 1,
        type: 'tool_error',
        ts: new Date(Date.now() - 5000).toISOString(),
        sessionId,
        project: 'test',
        projectPath: '/test',
        tool: 'Bash',
        error: 'command not found: npm',
        errorRaw: 'bash: npm: command not found'
      });

      // Insert prompt for context
      db.insertEvent({
        v: 1,
        type: 'prompt',
        ts: new Date(Date.now() - 3000).toISOString(),
        sessionId,
        project: 'test',
        projectPath: '/test',
        text: 'install node first'
      });

      // Trigger tool success
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm install' },
        session_id: sessionId,
        cwd: '/test'
      };

      await runHook(input);

      // Check resolution recorded in error_kb
      const errorKB = conn.prepare(
        'SELECT * FROM error_kb WHERE error_normalized LIKE ?'
      ).all('%command not found%');

      assert.ok(errorKB.length > 0, 'should record resolution in error_kb');
      const resolution = JSON.parse(errorKB[0].resolution);
      assert.equal(resolution.resolvedBy, 'success_after_error');
      assert.equal(resolution.tool, 'Bash');
      assert.ok(resolution.promptContext.includes('install node first'));
    });

    it('should include tool sequence context', async () => {
      const sessionId = 'tool-sequence-test';

      // Error
      db.insertEvent({
        v: 1,
        type: 'tool_error',
        ts: new Date(Date.now() - 10000).toISOString(),
        sessionId,
        project: 'test',
        projectPath: '/test',
        tool: 'Edit',
        error: 'file not found'
      });

      // Tools between error and success
      for (let i = 0; i < 3; i++) {
        db.insertEvent({
          v: 1,
          type: 'tool_use',
          ts: new Date(Date.now() - 8000 + i * 1000).toISOString(),
          sessionId,
          project: 'test',
          projectPath: '/test',
          tool: 'Read',
          meta: {},
          success: true
        });
      }

      // Success
      await runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/test.txt' },
        session_id: sessionId,
        cwd: '/test'
      });

      const errorKB = conn.prepare(
        'SELECT * FROM error_kb WHERE error_normalized LIKE ?'
      ).all('%file not found%');

      assert.ok(errorKB.length > 0);
      const resolution = JSON.parse(errorKB[0].resolution);
      assert.ok(Array.isArray(resolution.toolSequence));
      assert.ok(resolution.toolSequence.length <= 5);
    });

    it('should limit query to 50 recent events', async () => {
      const sessionId = 'limit-50-test';

      // Insert 60 events
      for (let i = 0; i < 60; i++) {
        db.insertEvent({
          v: 1,
          type: 'tool_use',
          ts: new Date(Date.now() - (60 - i) * 1000).toISOString(),
          sessionId,
          project: 'test',
          projectPath: '/test',
          tool: 'Read',
          meta: {},
          success: true
        });
      }

      // This should still work (only check last 50)
      await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'test' },
        session_id: sessionId,
        cwd: '/test'
      });

      // Should not throw or hang
      const events = db.queryEvents({ sessionId, limit: 100 });
      assert.ok(events.length >= 60);
    });
  });

  describe('REQ-DC-204: Cross-tool resolution detection', () => {
    it('should detect Read fail → Edit → Read success, then Edit detects cross-tool', async () => {
      const sessionId = 'cross-tool-test';

      // Read error
      db.insertEvent({
        v: 1,
        type: 'tool_error',
        ts: new Date(Date.now() - 10000).toISOString(),
        sessionId,
        project: 'test',
        projectPath: '/test',
        tool: 'Read',
        error: 'file not found: config.json',
        errorRaw: 'ENOENT: no such file or directory'
      });

      // Edit helps by creating the file
      db.insertEvent({
        v: 1,
        type: 'tool_use',
        ts: new Date(Date.now() - 8000).toISOString(),
        sessionId,
        project: 'test',
        projectPath: '/test',
        tool: 'Edit',
        meta: { file: '/config.json' },
        success: true
      });

      // Read succeeds (via hook to trigger same-tool resolution)
      await runHook({
        tool_name: 'Read',
        tool_input: { file_path: '/config.json' },
        session_id: sessionId,
        cwd: '/test'
      });

      // Verify same-tool resolution was recorded first
      let errorKB = conn.prepare(
        'SELECT * FROM error_kb WHERE error_normalized = ?'
      ).all('file not found: config.json');
      assert.equal(errorKB.length, 1, `Expected 1 error_kb entry, got ${errorKB.length}`);
      let resolution = JSON.parse(errorKB[0].resolution);
      assert.equal(resolution.resolvedBy, 'success_after_error');

      // Now Edit runs again - should detect it helped resolve Read error
      const result = await runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/config.json' },
        session_id: sessionId,
        cwd: '/test'
      });

      assert.equal(result.code, 0);

      // Check cross-tool resolution was recorded (overwrites same-tool)
      errorKB = conn.prepare(
        'SELECT * FROM error_kb WHERE error_normalized = ?'
      ).all('file not found: config.json');

      assert.equal(errorKB.length, 1, `Expected 1 error_kb entry, got ${errorKB.length}`);
      resolution = JSON.parse(errorKB[0].resolution);
      assert.equal(resolution.resolvedBy, 'cross_tool_resolution');
      assert.equal(resolution.helpingTool, 'Edit');
      assert.ok(Array.isArray(resolution.toolSequence));
      assert.ok(resolution.toolSequence.includes('Edit'));
    });
  });

  describe('REQ-DC-205: Non-blocking execution', () => {
    it('should exit 0 on invalid JSON stdin', async () => {
      const proc = spawn('node', ['hooks/tool-logger.mjs'], {
        cwd: '/Users/sungwon/projects/self-generation',
        env: { ...process.env, HOME: TEST_HOME },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      proc.stdin.write('invalid json{{{');
      proc.stdin.end();

      const code = await new Promise(resolve => proc.on('close', resolve));
      assert.equal(code, 0);
    });

    it('should not fail on resolution detection errors', async () => {
      // This test ensures silent fail in resolution detection
      const sessionId = 'resolution-error-test';

      // Malformed error entry (missing required fields)
      db.insertEvent({
        v: 1,
        type: 'tool_error',
        ts: new Date().toISOString(),
        sessionId,
        project: 'test',
        projectPath: '/test',
        tool: 'Bash'
        // Missing 'error' field intentionally
      });

      const result = await runHook({
        tool_name: 'Bash',
        tool_input: { command: 'test' },
        session_id: sessionId,
        cwd: '/test'
      });

      assert.equal(result.code, 0, 'should exit 0 despite resolution error');
    });
  });

  describe('REQ-DC-206: System activation check', () => {
    it('should skip recording when system disabled', async () => {
      // Disable system
      writeFileSync(
        join(SELF_GEN_DIR, 'config.json'),
        JSON.stringify({ enabled: false }, null, 2)
      );

      const sessionId = 'disabled-test';
      const result = await runHook({
        tool_name: 'Read',
        tool_input: { file_path: '/test.txt' },
        session_id: sessionId,
        cwd: '/test'
      });

      assert.equal(result.code, 0);

      const events = db.queryEvents({ sessionId });
      assert.equal(events.length, 0, 'should not record when disabled');

      // Re-enable for other tests
      writeFileSync(
        join(SELF_GEN_DIR, 'config.json'),
        JSON.stringify({ enabled: true }, null, 2)
      );
    });
  });
});
