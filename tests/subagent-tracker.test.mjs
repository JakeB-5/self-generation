// tests/subagent-tracker.test.mjs
// Test suite for hooks/subagent-tracker.mjs

import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

const TEST_HOME = join(process.cwd(), 'test-home-subagent-tracker');
const GLOBAL_DIR = join(TEST_HOME, '.self-generation');
const DATA_DIR = join(GLOBAL_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'self-gen.db');

function setup() {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
}

function runHook(stdinData) {
  const hookPath = join(process.cwd(), 'hooks', 'subagent-tracker.mjs');
  const env = { ...process.env, HOME: TEST_HOME };
  try {
    execSync(`node ${hookPath}`, { input: JSON.stringify(stdinData), env });
  } catch (e) {
    // Hook always exits 0, but capture any unexpected errors
  }
}

test('SubagentStop event recorded with correct fields', () => {
  setup();

  const stdinData = {
    session_id: 's1',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-123',
    agent_type: 'executor'
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT * FROM events WHERE type = ?').all('subagent_stop');
  assert.strictEqual(rows.length, 1);

  const row = rows[0];
  assert.strictEqual(row.type, 'subagent_stop');
  assert.strictEqual(row.session_id, 's1');
  assert.strictEqual(row.project, 'test-project');
  assert.strictEqual(row.project_path, '/Users/dev/test-project');

  const data = JSON.parse(row.data);
  assert.strictEqual(data.agentId, 'agent-123');
  assert.strictEqual(data.agentType, 'executor');

  // v9: success field should NOT exist
  assert.strictEqual(data.success, undefined);

  db.close();
});

test('No success field in event data (v9 requirement)', () => {
  setup();

  const stdinData = {
    session_id: 's2',
    cwd: '/project',
    agent_id: 'a1',
    agent_type: 'architect'
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM events WHERE session_id = ?').get('s2');
  const data = JSON.parse(row.data);

  assert.strictEqual(Object.hasOwn(data, 'success'), false, 'success field should not exist');
  assert.deepStrictEqual(Object.keys(data).sort(), ['agentId', 'agentType']);

  db.close();
});

test('Partial stdin fields handled gracefully', () => {
  setup();

  const stdinData = {
    session_id: 's3',
    cwd: '/project',
    agent_id: 'a2'
    // agent_type missing
  };

  runHook(stdinData);

  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM events WHERE session_id = ?').get('s3');
  assert.ok(row, 'Event should be recorded even with missing fields');

  const data = JSON.parse(row.data);
  assert.strictEqual(data.agentId, 'a2');
  assert.strictEqual(data.agentType, undefined);

  db.close();
});

test('System disabled — no event recorded', () => {
  setup();

  // Write config.json with enabled: false
  const configPath = join(GLOBAL_DIR, 'config.json');
  writeFileSync(configPath, JSON.stringify({ enabled: false }));

  const stdinData = {
    session_id: 's4',
    cwd: '/project',
    agent_id: 'a3',
    agent_type: 'executor'
  };

  runHook(stdinData);

  // DB may not be initialized if hook exits early, so check file existence
  if (!existsSync(DB_PATH)) {
    // If DB doesn't exist, the hook correctly exited without recording
    return;
  }

  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT * FROM events WHERE session_id = ?').all('s4');
  assert.strictEqual(rows.length, 0, 'No events should be recorded when disabled');

  db.close();
});

test('Invalid JSON stdin — exits 0 without crash', () => {
  setup();

  const hookPath = join(process.cwd(), 'hooks', 'subagent-tracker.mjs');
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

test('Multiple subagent events from different types', () => {
  setup();

  const events = [
    { session_id: 's5', cwd: '/p', agent_id: 'a1', agent_type: 'executor' },
    { session_id: 's5', cwd: '/p', agent_id: 'a2', agent_type: 'executor' },
    { session_id: 's5', cwd: '/p', agent_id: 'a3', agent_type: 'architect' }
  ];

  events.forEach(runHook);

  const db = new Database(DB_PATH);

  // Check total count
  const total = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE session_id = ?').get('s5').cnt;
  assert.strictEqual(total, 3);

  // SQL aggregation query (matching spec REQ-RA-202)
  const stats = db.prepare(`
    SELECT json_extract(data, '$.agentType') AS agent_type,
           COUNT(*) AS total
    FROM events WHERE type = 'subagent_stop'
    GROUP BY agent_type
  `).all();

  assert.strictEqual(stats.length, 2);
  const executorStat = stats.find(s => s.agent_type === 'executor');
  const architectStat = stats.find(s => s.agent_type === 'architect');

  assert.strictEqual(executorStat.total, 2);
  assert.strictEqual(architectStat.total, 1);

  db.close();
});

test('Empty events table — SQL aggregation returns empty result', () => {
  setup();

  // Need to initialize DB first by running a hook (or manually calling getDb)
  const stdinData = {
    session_id: 's_temp',
    cwd: '/project',
    agent_id: 'a_temp',
    agent_type: 'executor'
  };
  runHook(stdinData);

  const db = new Database(DB_PATH);

  // Clear the temporary event
  db.prepare('DELETE FROM events WHERE session_id = ?').run('s_temp');

  // Now test empty aggregation
  const stats = db.prepare(`
    SELECT json_extract(data, '$.agentType') AS agent_type,
           COUNT(*) AS total
    FROM events WHERE type = 'subagent_stop'
    GROUP BY agent_type
  `).all();

  assert.strictEqual(stats.length, 0);
  db.close();
});
