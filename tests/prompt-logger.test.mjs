// tests/prompt-logger.test.mjs
// Tests for hooks/prompt-logger.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

const projectRoot = process.cwd();
const hookPath = join(projectRoot, 'hooks', 'prompt-logger.mjs');

// Helper to setup test environment
function setupTestEnv(testHome) {
  const selfGenDir = join(testHome, '.self-generation');
  mkdirSync(join(selfGenDir, 'data'), { recursive: true });
}

// Helper to run hook with stdin (sync — blocks event loop)
function runHook(stdin, testHome) {
  setupTestEnv(testHome);
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(stdin),
    encoding: 'utf-8',
    env: { ...process.env, HOME: testHome }
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

// Helper to run hook async (does NOT block event loop — needed for mock servers)
function runHookAsync(stdin, testHome) {
  setupTestEnv(testHome);
  return new Promise((resolve) => {
    const proc = spawn('node', [hookPath], {
      env: { ...process.env, HOME: testHome },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    proc.stdin.write(JSON.stringify(stdin));
    proc.stdin.end();
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

// Helper to query events from test DB
function queryEvents(testHome, type) {
  const dbPath = join(testHome, '.self-generation', 'data', 'self-gen.db');
  const db = new Database(dbPath);
  const rows = db.prepare(`
    SELECT * FROM events WHERE type = ? ORDER BY ts DESC
  `).all(type);
  db.close();
  return rows.map(row => ({
    v: row.v,
    type: row.type,
    ts: row.ts,
    sessionId: row.session_id,
    project: row.project,
    projectPath: row.project_path,
    ...JSON.parse(row.data)
  }));
}

test('prompt-logger - basic prompt recording (REQ-DC-101)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);

  const stdin = {
    prompt: 'Fix the authentication bug',
    session_id: 'sess-basic',
    cwd: '/test/project'
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  const events = await queryEvents(testHome, 'prompt');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'prompt');
  assert.equal(events[0].sessionId, 'sess-basic');
  assert.equal(events[0].project, 'project');
  assert.equal(events[0].projectPath, '/test/project');
  assert.equal(events[0].text, 'Fix the authentication bug');
  assert.equal(events[0].charCount, 26);
  assert.equal(events[0].v, 1);

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - collectPromptText=false → [REDACTED] (REQ-DC-102)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  const selfGenDir = join(testHome, '.self-generation');
  mkdirSync(selfGenDir, { recursive: true });

  // Write config with collectPromptText=false
  writeFileSync(
    join(selfGenDir, 'config.json'),
    JSON.stringify({ collectPromptText: false })
  );

  const stdin = {
    prompt: 'This is a secret prompt',
    session_id: 'sess-redacted',
    cwd: '/test/project'
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  const events = await queryEvents(testHome, 'prompt');
  assert.equal(events.length, 1);
  assert.equal(events[0].text, '[REDACTED]');

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - private tag stripping (REQ-DC-103)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  const stdin = {
    prompt: 'Fix bug in <private>secret.js with API key abc123</private> module',
    session_id: 'sess-private',
    cwd: '/test/project'
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  const events = await queryEvents(testHome, 'prompt');
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'Fix bug in [PRIVATE] module');

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - skill detection with mock skill (REQ-DC-104)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);

  // Create mock project with skill
  const projectPath = join(testHome, 'test-project');
  const skillDir = join(projectPath, '.claude', 'commands');
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, 'deploy.md'), `# Deploy Skill

Deploy application to production.

## 감지된 패턴
- "deploy to production"
- "배포해줘"

## Usage
Run /deploy
`);

  // Create mock embedding server that returns empty embeddings
  // so matchSkill falls through to keyword matching
  const { createServer } = await import('net');
  const { unlinkSync, existsSync: exists } = await import('fs');
  const SOCKET = '/tmp/self-gen-embed.sock';
  try { if (exists(SOCKET)) unlinkSync(SOCKET); } catch {}

  const server = createServer((conn) => {
    let buf = '';
    conn.on('data', (data) => {
      buf += data.toString();
      try {
        const req = JSON.parse(buf);
        if (req.action === 'health') {
          conn.end(JSON.stringify({ status: 'ok' }));
        } else {
          conn.end(JSON.stringify({ embeddings: [] }));
        }
      } catch { /* wait for more data */ }
    });
  });

  server.listen(SOCKET);
  await new Promise(r => setTimeout(r, 100));

  const stdin = {
    prompt: 'deploy to production server',
    session_id: 'sess-skill',
    cwd: projectPath
  };

  // Use async runner so mock server event loop is not blocked
  const result = await runHookAsync(stdin, testHome);

  server.close();
  try { unlinkSync(SOCKET); } catch {}

  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes('[Self-Generation]'), `stdout should include [Self-Generation], got: ${result.stdout.slice(0, 200)}`);
  assert.ok(result.stdout.includes('/deploy'));
  assert.ok(result.stdout.includes('프로젝트'));

  // Verify JSON output structure
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(output.hookSpecificOutput.additionalContext.includes('/deploy'));

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - skill detection with global skill', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);

  // Create global skill
  const globalSkillDir = join(testHome, '.claude', 'commands');
  mkdirSync(globalSkillDir, { recursive: true });

  writeFileSync(join(globalSkillDir, 'docker-build.md'), `# Docker Build

Build Docker images.

## 감지된 패턴
- "docker build"
- "build image"

## Usage
Run /docker-build
`);

  // Create mock embedding server for fast keyword fallback
  const { createServer } = await import('net');
  const { unlinkSync, existsSync: exists } = await import('fs');
  const SOCKET = '/tmp/self-gen-embed.sock';
  try { if (exists(SOCKET)) unlinkSync(SOCKET); } catch {}

  const server = createServer((conn) => {
    let buf = '';
    conn.on('data', (data) => {
      buf += data.toString();
      try {
        const req = JSON.parse(buf);
        if (req.action === 'health') {
          conn.end(JSON.stringify({ status: 'ok' }));
        } else {
          conn.end(JSON.stringify({ embeddings: [] }));
        }
      } catch { /* wait for more data */ }
    });
  });

  server.listen(SOCKET);
  await new Promise(r => setTimeout(r, 100));

  const stdin = {
    prompt: 'docker build the application',
    session_id: 'sess-global',
    cwd: '/test/project'
  };

  // Use async runner so mock server event loop is not blocked
  const result = await runHookAsync(stdin, testHome);

  server.close();
  try { unlinkSync(SOCKET); } catch {}

  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes('/docker-build'), `stdout should include /docker-build, got: ${result.stdout.slice(0, 200)}`);
  assert.ok(result.stdout.includes('전역'));

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - skill detection timeout (2s)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  const stdin = {
    prompt: 'some random prompt',
    session_id: 'sess-timeout',
    cwd: '/test/project'
  };

  const start = Date.now();
  const result = runHook(stdin, testHome);
  const duration = Date.now() - start;

  assert.equal(result.exitCode, 0);
  // Should complete quickly (no skill match, no 2s wait)
  assert.ok(duration < 1000, `should complete quickly, took ${duration}ms`);

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - skill_used event for slash commands (REQ-DC-105)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  // Create skill
  const projectPath = join(testHome, 'test-project');
  const skillDir = join(projectPath, '.claude', 'commands');
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, 'test-api.md'), `# Test API

Run API tests.

## 감지된 패턴
- "test api"
`);

  const stdin = {
    prompt: '/test-api --verbose',
    session_id: 'sess-slash',
    cwd: projectPath
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  // Check both prompt and skill_used events
  const promptEvents = await queryEvents(testHome, 'prompt');
  assert.equal(promptEvents.length, 1);

  const skillEvents = await queryEvents(testHome, 'skill_used');
  assert.equal(skillEvents.length, 1);
  assert.equal(skillEvents[0].type, 'skill_used');
  assert.equal(skillEvents[0].sessionId, 'sess-slash');
  assert.equal(skillEvents[0].skillName, 'test-api');

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - slash command for non-existent skill (no event)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  const stdin = {
    prompt: '/nonexistent-skill',
    session_id: 'sess-nonexistent',
    cwd: '/test/project'
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  // Only prompt event, no skill_used event
  const promptEvents = await queryEvents(testHome, 'prompt');
  assert.equal(promptEvents.length, 1);

  const skillEvents = await queryEvents(testHome, 'skill_used');
  assert.equal(skillEvents.length, 0);

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - invalid JSON stdin → exit 0 (REQ-DC-106)', () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  const result = spawnSync('node', [hookPath], {
    input: 'invalid json{',
    encoding: 'utf-8',
    env: { ...process.env, HOME: testHome }
  });

  assert.equal(result.status, 0);

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - system disabled → no event (REQ-DC-106)', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  const selfGenDir = join(testHome, '.self-generation');
  const dataDir = join(selfGenDir, 'data');
  mkdirSync(dataDir, { recursive: true });

  // Write config with enabled=false
  writeFileSync(
    join(selfGenDir, 'config.json'),
    JSON.stringify({ enabled: false })
  );

  const stdin = {
    prompt: 'This should not be recorded',
    session_id: 'sess-disabled',
    cwd: '/test/project'
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  // Check if DB file was created (it should not be if system is disabled)
  const dbPath = join(dataDir, 'self-gen.db');
  const { existsSync } = await import('fs');
  if (existsSync(dbPath)) {
    const events = await queryEvents(testHome, 'prompt');
    assert.equal(events.length, 0);
  }

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - multiline private tags', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  const stdin = {
    prompt: `Fix the bug in:
<private>
file: secret.js
credentials: abc123
token: xyz789
</private>
And update tests`,
    session_id: 'sess-multiline',
    cwd: '/test/project'
  };

  const result = runHook(stdin, testHome);

  assert.equal(result.exitCode, 0);

  const events = await queryEvents(testHome, 'prompt');
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'Fix the bug in:\n[PRIVATE]\nAnd update tests');

  rmSync(testHome, { recursive: true, force: true });
});

test('prompt-logger - CLAUDE_PROJECT_DIR override', async () => {
  const testHome = join(tmpdir(), `prompt-logger-test-${Date.now()}`);
  
  const stdin = {
    prompt: 'Test prompt',
    session_id: 'sess-override',
    cwd: '/test/subdirectory'
  };

  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(stdin),
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: testHome,
      CLAUDE_PROJECT_DIR: '/override/project'
    }
  });

  assert.equal(result.status, 0);

  const events = await queryEvents(testHome, 'prompt');
  assert.equal(events.length, 1);
  assert.equal(events[0].projectPath, '/override/project');
  assert.equal(events[0].project, 'project');

  rmSync(testHome, { recursive: true, force: true });
});
