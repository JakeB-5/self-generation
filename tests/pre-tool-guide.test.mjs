// tests/pre-tool-guide.test.mjs
// Test suite for hooks/pre-tool-guide.mjs

import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

const TEST_HOME = join(process.cwd(), 'test-home-pre-tool-guide');
const GLOBAL_DIR = join(TEST_HOME, '.self-generation');
const DATA_DIR = join(GLOBAL_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'self-gen.db');

function setup() {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
}

function runHook(stdinData) {
  const hookPath = join(process.cwd(), 'hooks', 'pre-tool-guide.mjs');
  // Use current node process (already using node 22)
  const env = { ...process.env, HOME: TEST_HOME };
  try {
    const result = execSync(`node ${hookPath}`, {
      input: JSON.stringify(stdinData),
      env,
      encoding: 'utf-8'
    });
    return result;
  } catch (e) {
    // Hook always exits 0, return stdout if available
    return e.stdout || '';
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      v INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project TEXT,
      project_path TEXT,
      data JSON NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type);

    CREATE TABLE IF NOT EXISTS error_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      error_normalized TEXT NOT NULL,
      error_raw TEXT,
      resolution TEXT,
      resolved_by TEXT,
      tool_sequence TEXT,
      use_count INTEGER DEFAULT 0,
      last_used TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_error_kb_error ON error_kb(error_normalized);
  `);
}

test('Edit tool with file-related error in KB → stdout output', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);

  // Pre-seed error_kb with file-related error
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'TypeError: Cannot read property of undefined in index.ts',
    JSON.stringify({ resolvedBy: 'Edit', tool: 'Edit', toolSequence: ['Read', 'Edit', 'Bash'] }),
    5,
    new Date().toISOString()
  );
  db.close();

  const stdinData = {
    session_id: 's1',
    cwd: '/project',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/project/src/index.ts'
    }
  };

  const stdout = runHook(stdinData);

  assert.ok(stdout.length > 0, 'Should output to stdout');
  const output = JSON.parse(stdout);
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(output.hookSpecificOutput.additionalContext.includes('⚠️ 이 파일 관련 과거 에러'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('index.ts'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('해결 방법'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Read → Edit → Bash'));
});

test('Edit tool with no matching errors → no stdout', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);
  db.close();

  const stdinData = {
    session_id: 's2',
    cwd: '/project',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/project/src/unrelated.ts'
    }
  };

  const stdout = runHook(stdinData);

  assert.strictEqual(stdout.trim(), '', 'Should not output when no matching errors');
});

test('Bash tool with previous error in session → stdout', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);

  // Record a Bash error in events
  const errorMsg = 'npm: command not found';
  db.prepare(`
    INSERT INTO events (type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'tool_error',
    new Date().toISOString(),
    's3',
    'test-project',
    '/project',
    JSON.stringify({ tool: 'Bash', error: errorMsg })
  );

  // Add matching KB entry
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    errorMsg,
    JSON.stringify({ resolvedBy: 'Bash', toolSequence: ['Bash', 'Bash'] }),
    3,
    new Date().toISOString()
  );
  db.close();

  const stdinData = {
    session_id: 's3',
    cwd: '/project',
    tool_name: 'Bash',
    tool_input: {
      command: 'npm install'
    }
  };

  const stdout = runHook(stdinData);

  assert.ok(stdout.length > 0, 'Should output to stdout');
  const output = JSON.parse(stdout);
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(output.hookSpecificOutput.additionalContext.includes('💡 이 세션에서 Bash 에러 발생 이력'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes(errorMsg));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('이전 해결 경로'));
});

test('Bash tool with no session errors → no stdout', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);
  db.close();

  const stdinData = {
    session_id: 's4',
    cwd: '/project',
    tool_name: 'Bash',
    tool_input: {
      command: 'ls -la'
    }
  };

  const stdout = runHook(stdinData);

  assert.strictEqual(stdout.trim(), '', 'Should not output when no session errors');
});

test('Other tool types → no output', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);
  db.close();

  const stdinData = {
    session_id: 's5',
    cwd: '/project',
    tool_name: 'Read',
    tool_input: {
      file_path: '/project/src/file.ts'
    }
  };

  const stdout = runHook(stdinData);

  assert.strictEqual(stdout.trim(), '', 'Should not output for Read tool');
});

test('System disabled → no output', () => {
  setup();

  // Write config.json with enabled: false
  const configPath = join(GLOBAL_DIR, 'config.json');
  writeFileSync(configPath, JSON.stringify({ enabled: false }));

  const db = new Database(DB_PATH);
  initSchema(db);

  // Pre-seed error_kb
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'Error in test.ts',
    JSON.stringify({ resolvedBy: 'Edit' }),
    1,
    new Date().toISOString()
  );
  db.close();

  const stdinData = {
    session_id: 's6',
    cwd: '/project',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/project/test.ts'
    }
  };

  const stdout = runHook(stdinData);

  assert.strictEqual(stdout.trim(), '', 'Should not output when system disabled');
});

test('Invalid JSON → exit 0', () => {
  setup();

  const hookPath = join(process.cwd(), 'hooks', 'pre-tool-guide.mjs');
  const env = { ...process.env, HOME: TEST_HOME };

  const result = execSync(`node ${hookPath}`, {
    input: '{invalid json',
    env,
    encoding: 'utf-8'
  });

  assert.strictEqual(result.trim(), '', 'Should exit 0 with no output on invalid JSON');
});

test('Write tool with multiple file-related errors → multiple guides', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);

  // Pre-seed multiple errors for same file
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'SyntaxError in config.json',
    JSON.stringify({ resolvedBy: 'Edit', toolSequence: ['Edit'] }),
    2,
    new Date().toISOString(),
    new Date(Date.now() - 1000).toISOString(),
    'ValidationError in config.json',
    JSON.stringify({ resolvedBy: 'Write', toolSequence: ['Write', 'Bash'] }),
    1,
    new Date(Date.now() - 1000).toISOString()
  );
  db.close();

  const stdinData = {
    session_id: 's7',
    cwd: '/project',
    tool_name: 'Write',
    tool_input: {
      file_path: '/project/config.json'
    }
  };

  const stdout = runHook(stdinData);

  assert.ok(stdout.length > 0, 'Should output to stdout');
  const output = JSON.parse(stdout);
  assert.ok(output.hookSpecificOutput.additionalContext.includes('SyntaxError'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('ValidationError'));
});

test('Resolution JSON parsing failure → show raw resolution', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);

  // Pre-seed with invalid JSON in resolution
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'Error in broken.ts',
    'Not a JSON string',
    1,
    new Date().toISOString()
  );
  db.close();

  const stdinData = {
    session_id: 's8',
    cwd: '/project',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/project/broken.ts'
    }
  };

  const stdout = runHook(stdinData);

  assert.ok(stdout.length > 0, 'Should output to stdout');
  const output = JSON.parse(stdout);
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Not a JSON string'));
});

test('Task tool → no output (v9 disabled)', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);
  db.close();

  const stdinData = {
    session_id: 's9',
    cwd: '/project',
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'executor'
    }
  };

  const stdout = runHook(stdinData);

  assert.strictEqual(stdout.trim(), '', 'Task tool guidance is disabled in v9');
});

test('Bash error exists but no KB match → no output', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);

  // Record a Bash error without KB entry
  db.prepare(`
    INSERT INTO events (type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'tool_error',
    new Date().toISOString(),
    's10',
    'test-project',
    '/project',
    JSON.stringify({ tool: 'Bash', error: 'Unique error xyz123' })
  );
  db.close();

  const stdinData = {
    session_id: 's10',
    cwd: '/project',
    tool_name: 'Bash',
    tool_input: {
      command: 'some command'
    }
  };

  const stdout = runHook(stdinData);

  assert.strictEqual(stdout.trim(), '', 'Should not output when Bash error has no KB match');
});

test('File path without extension still matches', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);

  // Pre-seed error with filename without extension
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'Error in Makefile',
    JSON.stringify({ resolvedBy: 'Edit' }),
    1,
    new Date().toISOString()
  );
  db.close();

  const stdinData = {
    session_id: 's11',
    cwd: '/project',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/project/Makefile'
    }
  };

  const stdout = runHook(stdinData);

  assert.ok(stdout.length > 0, 'Should match filename without extension');
  const output = JSON.parse(stdout);
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Makefile'));
});

test('Hook execution completes within 2s timeout', () => {
  setup();

  const db = new Database(DB_PATH);
  initSchema(db);
  db.close();

  const stdinData = {
    session_id: 's12',
    cwd: '/project',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/project/test.ts'
    }
  };

  const start = Date.now();
  runHook(stdinData);
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 2000, 'Hook should complete within 2s');
});
