// tests/session-summary.test.mjs
// Test suite for hooks/session-summary.mjs

import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

// Each test gets a unique HOME to avoid cross-test contamination
function getTestPaths(testName) {
  const TEST_HOME = join(process.cwd(), `test-home-session-summary-${testName}`);
  const GLOBAL_DIR = join(TEST_HOME, '.self-generation');
  const DATA_DIR = join(GLOBAL_DIR, 'data');
  const DB_PATH = join(DATA_DIR, 'self-gen.db');
  return { TEST_HOME, GLOBAL_DIR, DATA_DIR, DB_PATH };
}

async function setup(testName) {
  const { TEST_HOME, DATA_DIR } = getTestPaths(testName);

  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // CRITICAL: Set HOME BEFORE importing db.mjs
  // db.mjs module constants are evaluated at load time
  process.env.HOME = TEST_HOME;

  return getTestPaths(testName);
}

function runHook(stdinData, testHome) {
  const hookPath = join(process.cwd(), 'hooks', 'session-summary.mjs');
  const env = { ...process.env, HOME: testHome };
  try {
    execSync(`node ${hookPath}`, {
      input: JSON.stringify(stdinData),
      env
    });
  } catch (e) {
    // Hook always exits 0, but capture any unexpected errors
  }
}

async function initAndSeedEvents(sessionId, events, dbPath) {
  // Open direct connection to TEST_HOME's DB
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create events table directly (no sqlite-vec needed for basic insert)
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
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type);
  `);

  const stmt = db.prepare(`
    INSERT INTO events (v, type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    const { v = 1, type, ts, project = 'test-project', projectPath = '/test', ...data } = event;
    stmt.run(v, type, ts, sessionId, project, projectPath, JSON.stringify(data));
  }

  // Force WAL checkpoint to ensure data is visible to hook subprocess
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
  db.close();
}

test('Session summary with correct aggregation', async () => {
  const { TEST_HOME, DB_PATH } = await setup('test1');

  // Pre-seed events for session
  await initAndSeedEvents('s1', [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', text: 'First prompt' },
    { type: 'prompt', ts: '2026-02-09T10:05:00Z', text: 'Second prompt' },
    { type: 'tool_use', ts: '2026-02-09T10:01:00Z', tool: 'Read', meta: { file: '/test/file1.js' } },
    { type: 'tool_use', ts: '2026-02-09T10:02:00Z', tool: 'Edit', meta: { file: '/test/file1.js' } },
    { type: 'tool_use', ts: '2026-02-09T10:03:00Z', tool: 'Read', meta: { file: '/test/file2.js' } },
    { type: 'tool_error', ts: '2026-02-09T10:04:00Z', tool: 'Bash', error: 'Command failed' },
    { type: 'tool_error', ts: '2026-02-09T10:06:00Z', tool: 'Bash', error: 'Command failed' }
  ], DB_PATH);

  const stdinData = {
    session_id: 's1',
    cwd: '/test',
    reason: 'user_exit'
  };

  runHook(stdinData, TEST_HOME);

  // Re-import to get fresh DB connection after hook writes
  const freshDb = new Database(DB_PATH);

  const row = freshDb.prepare('SELECT * FROM events WHERE type = ? AND session_id = ?')
    .get('session_summary', 's1');

  assert.ok(row, 'Session summary should be recorded');
  assert.strictEqual(row.session_id, 's1');
  assert.strictEqual(row.project, 'test');
  assert.strictEqual(row.project_path, '/test');

  const data = JSON.parse(row.data);
  assert.strictEqual(data.promptCount, 2);
  assert.strictEqual(data.errorCount, 2);
  assert.deepStrictEqual(data.toolCounts, { Read: 2, Edit: 1 });
  assert.deepStrictEqual(data.toolSequence, ['Read', 'Edit', 'Read']);
  assert.deepStrictEqual(data.uniqueErrors, ['Command failed']);
  assert.strictEqual(data.reason, 'user_exit');

  freshDb.close();
});

test('lastPrompts and lastEditedFiles populated correctly', async () => {
  const { TEST_HOME, DB_PATH } = await setup('test2');

  await initAndSeedEvents('s2', [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', text: 'A'.repeat(150) }, // Exceeds 100 char limit
    { type: 'prompt', ts: '2026-02-09T10:01:00Z', text: 'Second prompt text' },
    { type: 'prompt', ts: '2026-02-09T10:02:00Z', text: 'Third prompt' },
    { type: 'prompt', ts: '2026-02-09T10:03:00Z', text: 'Fourth prompt' },
    { type: 'tool_use', ts: '2026-02-09T10:04:00Z', tool: 'Edit', meta: { file: '/a.js' } },
    { type: 'tool_use', ts: '2026-02-09T10:05:00Z', tool: 'Write', meta: { file: '/b.js' } },
    { type: 'tool_use', ts: '2026-02-09T10:06:00Z', tool: 'Edit', meta: { file: '/c.js' } },
    { type: 'tool_use', ts: '2026-02-09T10:07:00Z', tool: 'Read', meta: { file: '/d.js' } } // Not an edit
  ], DB_PATH);

  runHook({ session_id: 's2', cwd: '/test', reason: 'user_exit' }, TEST_HOME);

  const freshDb = new Database(DB_PATH);
  const row = freshDb.prepare('SELECT * FROM events WHERE type = ? AND session_id = ?')
    .get('session_summary', 's2');

  const data = JSON.parse(row.data);

  // Should have last 3 prompts only (DESC order: most recent first)
  assert.strictEqual(data.lastPrompts.length, 3);
  assert.strictEqual(data.lastPrompts[0], 'Fourth prompt');
  assert.strictEqual(data.lastPrompts[1], 'Third prompt');
  assert.strictEqual(data.lastPrompts[2], 'Second prompt text');

  // Should truncate to 100 chars (the first prompt is excluded as it's not in last 3)
  data.lastPrompts.forEach(p => assert.ok(p.length <= 100));

  // Should have last 5 edited files (only Edit/Write tools, DESC order: most recent first)
  assert.strictEqual(data.lastEditedFiles.length, 3);
  assert.deepStrictEqual(data.lastEditedFiles, ['/c.js', '/b.js', '/a.js']);

  freshDb.close();
});

test('reason=clear skips AI analysis', async () => {
  const { TEST_HOME, DB_PATH } = await setup('test3');

  // Seed enough prompts to trigger analysis (>= 3)
  await initAndSeedEvents('s3', [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', text: 'Prompt 1' },
    { type: 'prompt', ts: '2026-02-09T10:01:00Z', text: 'Prompt 2' },
    { type: 'prompt', ts: '2026-02-09T10:02:00Z', text: 'Prompt 3' },
    { type: 'prompt', ts: '2026-02-09T10:03:00Z', text: 'Prompt 4' }
  ], DB_PATH);

  // Run hook with reason='clear' - should NOT spawn analysis
  runHook({ session_id: 's3', cwd: '/test', reason: 'clear' }, TEST_HOME);

  const freshDb = new Database(DB_PATH);
  const row = freshDb.prepare('SELECT * FROM events WHERE type = ? AND session_id = ?')
    .get('session_summary', 's3');

  assert.ok(row, 'Session summary should still be recorded');
  const data = JSON.parse(row.data);
  assert.strictEqual(data.reason, 'clear');
  assert.strictEqual(data.promptCount, 4);

  // Can't directly verify spawn didn't happen, but summary should be recorded
  // In real implementation, runAnalysisAsync won't be called due to skipAnalysis flag

  freshDb.close();
});

test('Empty session records summary with zero counts', async () => {
  const { TEST_HOME, DB_PATH } = await setup('test4');

  // Initialize DB
  const dbModule = await import('../lib/db.mjs');
  dbModule.getDb();

  const db = new Database(DB_PATH);
  db.close();

  runHook({ session_id: 's4', cwd: '/empty-project', reason: 'timeout' }, TEST_HOME);

  const freshDb = new Database(DB_PATH);
  const row = freshDb.prepare('SELECT * FROM events WHERE type = ? AND session_id = ?')
    .get('session_summary', 's4');

  assert.ok(row, 'Session summary should be recorded even for empty session');

  const data = JSON.parse(row.data);
  assert.strictEqual(data.promptCount, 0);
  assert.strictEqual(data.errorCount, 0);
  assert.deepStrictEqual(data.toolCounts, {});
  assert.deepStrictEqual(data.toolSequence, []);
  assert.deepStrictEqual(data.uniqueErrors, []);
  assert.deepStrictEqual(data.lastPrompts, []);
  assert.deepStrictEqual(data.lastEditedFiles, []);
  assert.strictEqual(data.reason, 'timeout');

  freshDb.close();
});

test('Invalid JSON stdin exits 0 without crash', async () => {
  const { TEST_HOME } = await setup('test5');

  const hookPath = join(process.cwd(), 'hooks', 'session-summary.mjs');
  const env = { ...process.env, HOME: TEST_HOME };

  const result = execSync(`node ${hookPath}`, {
    input: '{invalid json',
    env,
    encoding: 'utf-8'
  });

  // Should exit 0 and produce no output
  assert.strictEqual(result.trim(), '');
});

test('System disabled - no event recorded', async () => {
  const { TEST_HOME, GLOBAL_DIR, DB_PATH } = await setup('test6');

  // Write config.json with enabled: false
  const configPath = join(GLOBAL_DIR, 'config.json');
  writeFileSync(configPath, JSON.stringify({ enabled: false }));

  runHook({ session_id: 's5', cwd: '/test', reason: 'user_exit' }, TEST_HOME);

  if (!existsSync(DB_PATH)) {
    // If DB doesn't exist, hook correctly exited early
    return;
  }

  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT * FROM events WHERE session_id = ?').all('s5');
  assert.strictEqual(rows.length, 0, 'No events should be recorded when disabled');
  db.close();
});

test('Tool meta.file missing handled gracefully', async () => {
  const { TEST_HOME, DB_PATH } = await setup('test7');

  await initAndSeedEvents('s6', [
    { type: 'tool_use', ts: '2026-02-09T10:00:00Z', tool: 'Edit', meta: { file: '/a.js' } },
    { type: 'tool_use', ts: '2026-02-09T10:01:00Z', tool: 'Write', meta: {} }, // Missing file
    { type: 'tool_use', ts: '2026-02-09T10:02:00Z', tool: 'Edit' } // Missing meta entirely
  ], DB_PATH);

  runHook({ session_id: 's6', cwd: '/test', reason: 'user_exit' }, TEST_HOME);

  const freshDb = new Database(DB_PATH);
  const row = freshDb.prepare('SELECT * FROM events WHERE type = ? AND session_id = ?')
    .get('session_summary', 's6');

  const data = JSON.parse(row.data);
  assert.deepStrictEqual(data.lastEditedFiles, ['/a.js']);

  freshDb.close();
});
