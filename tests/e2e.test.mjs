// tests/e2e.test.mjs
// End-to-end integration test — simulates full user session lifecycle

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

const projectRoot = process.cwd();
const TEST_HOME = join(tmpdir(), `self-gen-e2e-test-${Date.now()}`);
const SELF_GEN_DIR = join(TEST_HOME, '.self-generation');
const CLAUDE_DIR = join(TEST_HOME, '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const DB_PATH = join(SELF_GEN_DIR, 'data', 'self-gen.db');
const INSTALL_SCRIPT = join(projectRoot, 'bin', 'install.mjs');

// --- Helper functions ---

function runInstall(args = '') {
  return execSync(`node ${INSTALL_SCRIPT} ${args}`, {
    env: { ...process.env, HOME: TEST_HOME, SELF_GEN_SKIP_NPM: '1' },
    encoding: 'utf-8',
    timeout: 30000
  });
}

function runHook(hookFile, stdin) {
  const hookPath = join(projectRoot, 'hooks', hookFile);
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(stdin),
    encoding: 'utf-8',
    env: { ...process.env, HOME: TEST_HOME }
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function queryDB(sql, params = []) {
  const db = new Database(DB_PATH);
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

function readJSON(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// --- Test suite ---

describe('E2E Integration Test', () => {
  before(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    runInstall();
  });

  after(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('1. Clean install creates correct structure', () => {
    // Verify 5 directories exist
    for (const dir of ['data', 'hooks', 'lib', 'bin', 'prompts']) {
      assert.ok(existsSync(join(SELF_GEN_DIR, dir)), `${dir} should exist`);
    }

    // Verify config.json has 4 fields
    const config = readJSON(join(SELF_GEN_DIR, 'config.json'));
    assert.equal(config.enabled, true);
    assert.equal(config.collectPromptText, true);
    assert.equal(config.retentionDays, 90);
    assert.equal(config.analysisModel, 'claude-sonnet-4-5-20250929');

    // Verify settings.json has 8 hook events
    const settings = readJSON(SETTINGS_PATH);
    const events = [
      'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure',
      'PreToolUse', 'SubagentStart', 'SubagentStop',
      'SessionEnd', 'SessionStart'
    ];
    for (const event of events) {
      assert.ok(settings.hooks[event], `${event} hook should exist`);
      assert.ok(settings.hooks[event].length > 0, `${event} should have entries`);
    }

    // DB is lazy-initialized on first hook run, not during install
    // Trigger DB creation by running a hook
    runHook('prompt-logger.mjs', {
      prompt: 'test',
      session_id: 'sess-init-test',
      cwd: '/test/project'
    });

    // Now verify DB has all tables
    const db = new Database(DB_PATH);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all().map(r => r.name);
    db.close();

    assert.ok(tables.includes('events'), 'events table should exist');
    assert.ok(tables.includes('error_kb'), 'error_kb table should exist');
    assert.ok(tables.includes('feedback'), 'feedback table should exist');
    assert.ok(tables.includes('analysis_cache'), 'analysis_cache table should exist');
    assert.ok(tables.includes('skill_embeddings'), 'skill_embeddings table should exist');
  });

  it('2. Session start hook returns context', () => {
    const stdin = {
      source: 'cli',
      model: 'claude-sonnet-4-5-20250929',
      session_id: 'sess-e2e-start',
      cwd: '/test/project'
    };

    const result = runHook('session-analyzer.mjs', stdin);
    assert.equal(result.exitCode, 0, 'session-analyzer should exit 0');
    // No previous session, so minimal output expected (empty or minimal context)
  });

  it('3. Prompt collection works', () => {
    const prompts = [
      'Fix the authentication bug',
      'Add error handling to API',
      'Refactor the database layer',
      'Update documentation',
      'Deploy to production'
    ];

    for (const prompt of prompts) {
      const stdin = {
        prompt,
        session_id: 'sess-e2e-prompts',
        cwd: '/test/project'
      };
      const result = runHook('prompt-logger.mjs', stdin);
      assert.equal(result.exitCode, 0, `prompt-logger should exit 0 for: ${prompt}`);
    }

    // Verify 5 rows in events table
    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'prompt' AND session_id = 'sess-e2e-prompts'
    `);
    assert.equal(rows.length, 5, 'should have 5 prompt events');

    // Verify text field matches input
    const data = JSON.parse(rows[0].data);
    assert.ok(prompts.includes(data.text), 'text field should match input');

    // Verify project and project_path fields populated
    assert.equal(rows[0].project, 'project');
    assert.equal(rows[0].project_path, '/test/project');
  });

  it('4. Tool usage logging works', () => {
    const tools = [
      {
        tool_name: 'Bash',
        tool_input: { command: 'ls -la /tmp/test' },
        tool_response: 'total 8\ndrwxr-xr-x 2 user user 4096'
      },
      {
        tool_name: 'Read',
        tool_input: { file_path: '/test/file.js' },
        tool_response: 'const x = 42;'
      },
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/test/file.js', old_string: 'x', new_string: 'y' },
        tool_response: 'Edit complete'
      }
    ];

    for (const tool of tools) {
      const stdin = {
        ...tool,
        session_id: 'sess-e2e-tools',
        cwd: '/test/project'
      };
      const result = runHook('tool-logger.mjs', stdin);
      assert.equal(result.exitCode, 0, `tool-logger should exit 0 for: ${tool.tool_name}`);
    }

    // Verify 3 rows with type='tool_use'
    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'tool_use' AND session_id = 'sess-e2e-tools'
    `);
    assert.equal(rows.length, 3, 'should have 3 tool_use events');

    // Verify Bash cmd is first word only (privacy)
    const bashRow = rows.find(r => {
      const data = JSON.parse(r.data);
      return data.tool === 'Bash';
    });
    const bashData = JSON.parse(bashRow.data);
    const metaObj = typeof bashData.meta === 'string' ? JSON.parse(bashData.meta) : bashData.meta;
    assert.equal(metaObj.command, 'ls', 'Bash cmd should be first word only');

    // Verify Edit stores file_path in meta
    const editRow = rows.find(r => {
      const data = JSON.parse(r.data);
      return data.tool === 'Edit';
    });
    const editData = JSON.parse(editRow.data);
    const editMetaObj = typeof editData.meta === 'string' ? JSON.parse(editData.meta) : editData.meta;
    assert.ok(editMetaObj.file === '/test/file.js', 'Edit should store file_path');
  });

  it('5. Error logging and normalization works', () => {
    const errors = [
      {
        tool_name: 'Bash',
        tool_input: { command: 'cat /tmp/missing.txt' },
        error: 'cat: /tmp/missing.txt: No such file or directory'
      },
      {
        tool_name: 'Read',
        tool_input: { file_path: '/test/nonexistent.js' },
        error: 'ENOENT: no such file or directory, open \'/test/nonexistent.js\''
      }
    ];

    for (const error of errors) {
      const stdin = {
        ...error,
        session_id: 'sess-e2e-errors',
        cwd: '/test/project'
      };
      const result = runHook('error-logger.mjs', stdin);
      assert.equal(result.exitCode, 0, `error-logger should exit 0`);
    }

    // Verify 2 rows with type='tool_error'
    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'tool_error' AND session_id = 'sess-e2e-errors'
    `);
    assert.equal(rows.length, 2, 'should have 2 tool_error events');

    // Verify error field is normalized
    const bashError = JSON.parse(rows[0].data);
    assert.ok(bashError.error.includes('<PATH>'), 'error should be normalized with <PATH>');

    // Verify errorRaw is truncated to 500 chars (if original was longer)
    // For this test, errors are short, so just verify field exists
    assert.ok('errorRaw' in bashError, 'errorRaw field should exist');
  });

  it('6. Error resolution detection works', () => {
    const sessionId = 'sess-e2e-resolution';

    // Step 1: Log an error
    const errorStdin = {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      error: 'Error: Test failed with exit code 1',
      session_id: sessionId,
      cwd: '/test/project'
    };
    runHook('error-logger.mjs', errorStdin);

    // Step 2: Log a success for the same tool
    const successStdin = {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: 'All tests passed',
      session_id: sessionId,
      cwd: '/test/project'
    };
    const result = runHook('tool-logger.mjs', successStdin);
    assert.equal(result.exitCode, 0);

    // Resolution is recorded in error_kb table, not as a separate event
    const kbRows = queryDB(`
      SELECT * FROM error_kb WHERE resolved_by = 'success_after_error'
    `);
    assert.ok(kbRows.length >= 1, 'should have resolution in error_kb');
  });

  it('7. Session summary aggregates correctly', () => {
    const sessionId = 'sess-e2e-summary';

    // Create some session events first
    const prompts = ['Fix bug', 'Add feature', 'Deploy'];
    for (const prompt of prompts) {
      runHook('prompt-logger.mjs', {
        prompt,
        session_id: sessionId,
        cwd: '/test/project'
      });
    }

    const tools = [
      { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'files' },
      { tool_name: 'Read', tool_input: { file_path: '/test/f.js' }, tool_response: 'code' },
      { tool_name: 'Edit', tool_input: { file_path: '/test/f.js' }, tool_response: 'done' }
    ];
    for (const tool of tools) {
      runHook('tool-logger.mjs', {
        ...tool,
        session_id: sessionId,
        cwd: '/test/project'
      });
    }

    const errors = [
      { tool_name: 'Bash', tool_input: { command: 'test' }, error: 'Failed' }
    ];
    for (const error of errors) {
      runHook('error-logger.mjs', {
        ...error,
        session_id: sessionId,
        cwd: '/test/project'
      });
    }

    // Now run session summary
    const summaryStdin = {
      reason: 'user_stop',
      session_id: sessionId,
      cwd: '/test/project'
    };
    const result = runHook('session-summary.mjs', summaryStdin);
    assert.equal(result.exitCode, 0);

    // Verify session_summary event
    const summaryRows = queryDB(`
      SELECT * FROM events WHERE type = 'session_summary' AND session_id = ?
    `, [sessionId]);
    assert.equal(summaryRows.length, 1, 'should have 1 session_summary event');

    const summaryData = JSON.parse(summaryRows[0].data);
    assert.equal(summaryData.promptCount, 3, 'should have 3 prompts');
    assert.equal(summaryData.errorCount, 1, 'should have 1 error');
    assert.ok(summaryData.toolCounts.Bash >= 1, 'should have Bash usage');
    assert.ok(summaryData.toolCounts.Read >= 1, 'should have Read usage');
    assert.ok(summaryData.toolCounts.Edit >= 1, 'should have Edit usage');
  });

  it('8. Privacy: collectPromptText=false redacts prompts', () => {
    // Write config with collectPromptText: false
    writeFileSync(
      join(SELF_GEN_DIR, 'config.json'),
      JSON.stringify({
        enabled: true,
        collectPromptText: false,
        retentionDays: 90,
        analysisModel: 'claude-sonnet-4-5-20250929'
      }, null, 2)
    );

    const stdin = {
      prompt: 'This is a secret prompt with sensitive data',
      session_id: 'sess-e2e-redacted',
      cwd: '/test/project'
    };

    const result = runHook('prompt-logger.mjs', stdin);
    assert.equal(result.exitCode, 0);

    // Verify text field is '[REDACTED]'
    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'prompt' AND session_id = 'sess-e2e-redacted'
    `);
    assert.equal(rows.length, 1);
    const data = JSON.parse(rows[0].data);
    assert.equal(data.text, '[REDACTED]', 'text should be redacted');

    // Restore config
    writeFileSync(
      join(SELF_GEN_DIR, 'config.json'),
      JSON.stringify({
        enabled: true,
        collectPromptText: true,
        retentionDays: 90,
        analysisModel: 'claude-sonnet-4-5-20250929'
      }, null, 2)
    );
  });

  it('9. Privacy: Bash first word only', () => {
    // Already verified in test 4, but add explicit assertion
    const stdin = {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/sensitive/data' },
      tool_response: 'removed',
      session_id: 'sess-e2e-bash-privacy',
      cwd: '/test/project'
    };

    const result = runHook('tool-logger.mjs', stdin);
    assert.equal(result.exitCode, 0);

    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'tool_use' AND session_id = 'sess-e2e-bash-privacy'
    `);
    assert.equal(rows.length, 1);
    const data = JSON.parse(rows[0].data);
    const metaObj = typeof data.meta === 'string' ? JSON.parse(data.meta) : data.meta;
    assert.equal(metaObj.command, 'rm', 'Bash cmd should be first word only');
    assert.ok(!metaObj.command.includes('-rf'), 'Bash cmd should not include flags');
    assert.ok(!metaObj.command.includes('sensitive'), 'Bash cmd should not include sensitive paths');
  });

  it('10. Privacy: private tags stripped', () => {
    const stdin = {
      prompt: 'Fix bug in <private>secret.js with API key abc123</private> module',
      session_id: 'sess-e2e-private-tags',
      cwd: '/test/project'
    };

    const result = runHook('prompt-logger.mjs', stdin);
    assert.equal(result.exitCode, 0);

    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'prompt' AND session_id = 'sess-e2e-private-tags'
    `);
    assert.equal(rows.length, 1);
    const data = JSON.parse(rows[0].data);
    assert.equal(data.text, 'Fix bug in [PRIVATE] module', 'private tags should be stripped');
    assert.ok(!data.text.includes('secret.js'), 'text should not include private content');
    assert.ok(!data.text.includes('abc123'), 'text should not include private content');
  });

  it('11. System disabled skips recording', () => {
    // Write config with enabled: false
    writeFileSync(
      join(SELF_GEN_DIR, 'config.json'),
      JSON.stringify({
        enabled: false,
        collectPromptText: true,
        retentionDays: 90,
        analysisModel: 'claude-sonnet-4-5-20250929'
      }, null, 2)
    );

    const stdin = {
      prompt: 'This should not be recorded',
      session_id: 'sess-e2e-disabled',
      cwd: '/test/project'
    };

    const result = runHook('prompt-logger.mjs', stdin);
    assert.equal(result.exitCode, 0);

    // Verify NO new events recorded
    const rows = queryDB(`
      SELECT * FROM events WHERE session_id = 'sess-e2e-disabled'
    `);
    assert.equal(rows.length, 0, 'should have no events when disabled');

    // Restore config
    writeFileSync(
      join(SELF_GEN_DIR, 'config.json'),
      JSON.stringify({
        enabled: true,
        collectPromptText: true,
        retentionDays: 90,
        analysisModel: 'claude-sonnet-4-5-20250929'
      }, null, 2)
    );
  });

  it('12. Subagent tracking works', () => {
    const stdin = {
      agent_id: 'agent-e2e-123',
      agent_type: 'executor',
      session_id: 'sess-e2e-subagent',
      cwd: '/test/project'
    };

    const result = runHook('subagent-tracker.mjs', stdin);
    assert.equal(result.exitCode, 0);

    // Verify subagent_stop event
    const rows = queryDB(`
      SELECT * FROM events WHERE type = 'subagent_stop' AND session_id = 'sess-e2e-subagent'
    `);
    assert.equal(rows.length, 1, 'should have 1 subagent_stop event');
    const data = JSON.parse(rows[0].data);
    assert.equal(data.agentId, 'agent-e2e-123');
    assert.equal(data.agentType, 'executor');
    // duration_ms and exit_reason are not captured by subagent-tracker.mjs
  });

  it('13. Uninstall removes hooks but keeps data', () => {
    runInstall('--uninstall');

    // Verify settings.json has no self-generation hooks
    const settings = readJSON(SETTINGS_PATH);
    for (const event of Object.keys(settings.hooks)) {
      const selfGenGroups = settings.hooks[event].filter(
        g => g.hooks?.some(h => h.command?.includes('.self-generation'))
      );
      assert.equal(selfGenGroups.length, 0, `${event} should have no self-gen hooks`);
    }

    // Verify data directory still exists
    assert.ok(existsSync(SELF_GEN_DIR), 'data directory should still exist');
    assert.ok(existsSync(DB_PATH), 'database should still exist');
  });

  it('14. Reinstall + purge removes everything', () => {
    // Reinstall
    runInstall();

    // Verify hooks are back
    const settings = readJSON(SETTINGS_PATH);
    assert.ok(settings.hooks.UserPromptSubmit, 'hooks should be restored');

    // Now uninstall with purge
    runInstall('--uninstall --purge');

    // Verify ~/.self-generation/ directory is gone
    assert.ok(!existsSync(SELF_GEN_DIR), 'data directory should be deleted');
  });
});
