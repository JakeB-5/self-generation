// tests/error-logger.test.mjs
// Test suite for hooks/error-logger.mjs

import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

const TEST_HOME = join(process.cwd(), 'test-home-error-logger');
const GLOBAL_DIR = join(TEST_HOME, '.self-generation');
const DATA_DIR = join(GLOBAL_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'self-gen.db');

function setup() {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
}

function runHook(stdinData) {
  const hookPath = join(process.cwd(), 'hooks', 'error-logger.mjs');
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

test('Basic error recording with normalized + raw fields', () => {
  setup();

  const stdinData = {
    session_id: 's1',
    cwd: '/Users/dev/test-project',
    tool_name: 'Bash',
    error: 'ENOENT: no such file or directory, open "/Users/dev/file.txt"'
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT * FROM events WHERE type = ?').all('tool_error');
  assert.strictEqual(rows.length, 1);

  const row = rows[0];
  assert.strictEqual(row.type, 'tool_error');
  assert.strictEqual(row.session_id, 's1');
  assert.strictEqual(row.project, 'test-project');
  assert.strictEqual(row.project_path, '/Users/dev/test-project');

  const data = JSON.parse(row.data);
  assert.strictEqual(data.tool, 'Bash');
  assert.ok(data.error, 'Normalized error should exist');
  assert.ok(data.errorRaw, 'Raw error should exist');
  assert.notStrictEqual(data.error, data.errorRaw, 'Normalized should differ from raw');

  db.close();
});

test('Error normalization applied correctly', () => {
  setup();

  const stdinData = {
    session_id: 's2',
    cwd: '/project',
    tool_name: 'Read',
    error: 'File not found: "/Users/dev/my-project/src/file123.txt" (line 42)'
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM events WHERE session_id = ?').get('s2');
  const data = JSON.parse(row.data);

  // Normalized should replace paths, numbers, quoted strings
  assert.ok(data.error.includes('<PATH>') || data.error.includes('<STR>'), 'Should contain normalized tokens');
  assert.ok(!data.error.includes('/Users/dev'), 'Should not contain original path');
  assert.ok(!data.error.includes('123'), 'Should not contain 3-digit numbers');

  // Raw should be unchanged (truncated to 500 chars)
  assert.ok(data.errorRaw.includes('File not found'), 'Raw error should be preserved');

  db.close();
});

test('KB match outputs hookSpecificOutput to stdout', () => {
  setup();

  // Pre-seed error_kb with a resolution
  const db = new Database(DB_PATH);

  // Initialize schema first
  const initScript = `
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
  `;
  db.exec(initScript);

  const normalizedError = 'ENOENT: no such file or directory, open <PATH>';
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, error_raw, resolution, resolved_by, tool_sequence, use_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    normalizedError,
    'ENOENT: no such file or directory, open "/path/to/file"',
    JSON.stringify({ resolvedBy: 'Write', toolSequence: ['Write', 'Bash'] }),
    'Write',
    'Write → Bash',
    5
  );
  db.close();

  // Run hook with matching error
  const stdinData = {
    session_id: 's3',
    cwd: '/project',
    tool_name: 'Read',
    error: 'ENOENT: no such file or directory, open "/different/path/file.txt"'
  };

  const stdout = runHook(stdinData);

  // Verify stdout contains hookSpecificOutput
  assert.ok(stdout.length > 0, 'Should output to stdout');
  const output = JSON.parse(stdout);
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Self-Generation 에러 KB'));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('Write'));
});

test('No KB match — no stdout output', () => {
  setup();

  const stdinData = {
    session_id: 's4',
    cwd: '/project',
    tool_name: 'Bash',
    error: 'Unique error that has never occurred before xyz123'
  };

  const stdout = runHook(stdinData);

  // No KB match, so no output
  assert.strictEqual(stdout.trim(), '', 'Should not output when no KB match');

  // But event should still be recorded
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM events WHERE session_id = ?').get('s4');
  assert.ok(row, 'Event should be recorded even without KB match');
  db.close();
});

test('Invalid JSON stdin — exit 0 without crash', () => {
  setup();

  const hookPath = join(process.cwd(), 'hooks', 'error-logger.mjs');
  const env = { ...process.env, HOME: TEST_HOME };

  // Invalid JSON
  const result = execSync(`node ${hookPath}`, {
    input: '{invalid json',
    env,
    encoding: 'utf-8'
  });

  // Should exit 0 and produce no output
  assert.strictEqual(result.trim(), '');
});

test('System disabled — no event recorded', () => {
  setup();

  // Write config.json with enabled: false
  const configPath = join(GLOBAL_DIR, 'config.json');
  writeFileSync(configPath, JSON.stringify({ enabled: false }));

  const stdinData = {
    session_id: 's5',
    cwd: '/project',
    tool_name: 'Bash',
    error: 'Some error'
  };

  runHook(stdinData);

  // DB may not be initialized if hook exits early
  if (!existsSync(DB_PATH)) {
    // Correct behavior: hook exited without initializing DB
    return;
  }

  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT * FROM events WHERE session_id = ?').all('s5');
  assert.strictEqual(rows.length, 0, 'No events should be recorded when disabled');
  db.close();
});

test('Long error truncated to 500 chars in errorRaw', () => {
  setup();

  const longError = 'Error: ' + 'x'.repeat(600);
  const stdinData = {
    session_id: 's6',
    cwd: '/project',
    tool_name: 'Bash',
    error: longError
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM events WHERE session_id = ?').get('s6');
  const data = JSON.parse(row.data);

  assert.ok(data.errorRaw.length <= 500, 'errorRaw should be truncated to 500 chars');
  db.close();
});

test('Missing error field handled gracefully', () => {
  setup();

  const stdinData = {
    session_id: 's7',
    cwd: '/project',
    tool_name: 'Bash'
    // error field missing
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM events WHERE session_id = ?').get('s7');
  assert.ok(row, 'Event should be recorded even without error field');

  const data = JSON.parse(row.data);
  assert.strictEqual(data.error, '', 'Normalized error should be empty string');
  assert.strictEqual(data.errorRaw, '', 'Raw error should be empty string');

  db.close();
});

test('2s timeout prevents hanging on KB search', async () => {
  setup();

  const stdinData = {
    session_id: 's8',
    cwd: '/project',
    tool_name: 'Bash',
    error: 'Test timeout error'
  };

  const start = Date.now();
  runHook(stdinData);
  const elapsed = Date.now() - start;

  // Hook should complete quickly even if KB search times out
  assert.ok(elapsed < 3000, 'Hook should complete within 3s (2s timeout + overhead)');
});
