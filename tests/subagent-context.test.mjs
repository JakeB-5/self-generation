// tests/subagent-context.test.mjs
// Test suite for hooks/subagent-context.mjs

import test from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

const TEST_HOME = join(process.cwd(), 'test-home-subagent-context');
const GLOBAL_DIR = join(TEST_HOME, '.self-generation');
const DATA_DIR = join(GLOBAL_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'self-gen.db');

function setup() {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
}

function initDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      v INTEGER NOT NULL,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      session_id TEXT,
      project TEXT,
      project_path TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_project_path ON events(project_path);
  `);

  // Create error_kb table
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_normalized TEXT NOT NULL UNIQUE,
      resolution TEXT,
      use_count INTEGER DEFAULT 1,
      last_used TEXT
    );
  `);

  // Create analysis_cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_cache (
      ts TEXT NOT NULL,
      project TEXT NOT NULL,
      days INTEGER NOT NULL,
      input_hash TEXT,
      analysis TEXT NOT NULL,
      PRIMARY KEY (project, days, input_hash)
    );
  `);

  return db;
}

function runHook(stdinData) {
  const hookPath = join(process.cwd(), 'hooks', 'subagent-context.mjs');
  const env = { ...process.env, HOME: TEST_HOME };
  try {
    const result = execSync(`node ${hookPath}`, {
      input: JSON.stringify(stdinData),
      env,
      encoding: 'utf-8'
    });
    return result.trim();
  } catch (e) {
    // Hook always exits 0, but capture output
    return e.stdout?.trim() || '';
  }
}

test('Code agent with project errors — outputs context', () => {
  setup();
  const db = initDb();

  // Insert tool_error events
  db.prepare(`
    INSERT INTO events (v, type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    'tool_error',
    new Date().toISOString(),
    's1',
    'test-project',
    '/Users/dev/test-project',
    JSON.stringify({ tool: 'Bash', error: 'Command failed: npm test' })
  );

  // Insert error_kb entry
  db.prepare(`
    INSERT INTO error_kb (error_normalized, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?)
  `).run(
    'Command failed: npm test',
    JSON.stringify({ resolvedBy: 'Fixed package.json', tool: 'Edit' }),
    2,
    new Date().toISOString()
  );

  db.close();

  const stdinData = {
    session_id: 's1',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-123',
    agent_type: 'executor'
  };

  const output = runHook(stdinData);
  assert.ok(output.length > 0, 'Should produce output');

  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('이 프로젝트의 최근 에러 패턴'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Command failed: npm test'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Fixed package.json'));
});

test('Non-code agent type — no output', () => {
  setup();
  initDb().close();

  const stdinData = {
    session_id: 's2',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-456',
    agent_type: 'researcher'
  };

  const output = runHook(stdinData);
  assert.strictEqual(output, '', 'Non-code agents should produce no output');
});

test('No errors, no analysis — no output', () => {
  setup();
  initDb().close();

  const stdinData = {
    session_id: 's3',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-789',
    agent_type: 'executor'
  };

  const output = runHook(stdinData);
  assert.strictEqual(output, '', 'Should produce no output when no context available');
});

test('Cached analysis with claude_md rules — included in output', () => {
  setup();
  const db = initDb();

  // Insert analysis_cache entry
  const analysis = {
    suggestions: [
      { type: 'claude_md', project: 'test-project', rule: 'Always use TypeScript strict mode' },
      { type: 'claude_md', project: null, summary: 'Prefer async/await over promises' },
      { type: 'skill', summary: 'Some skill suggestion' } // Should be filtered out
    ]
  };

  db.prepare(`
    INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'test-project',
    7,
    'hash123',
    JSON.stringify(analysis)
  );

  db.close();

  const stdinData = {
    session_id: 's4',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-abc',
    agent_type: 'architect'
  };

  const output = runHook(stdinData);
  assert.ok(output.length > 0, 'Should produce output');

  const parsed = JSON.parse(output);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('적용할 프로젝트 규칙'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Always use TypeScript strict mode'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Prefer async/await over promises'));
  assert.ok(!parsed.hookSpecificOutput.additionalContext.includes('Some skill suggestion'));
});

test('Context truncated to 500 chars', () => {
  setup();
  const db = initDb();

  // Insert multiple errors to exceed 500 chars
  for (let i = 0; i < 10; i++) {
    db.prepare(`
      INSERT INTO events (v, type, ts, session_id, project, project_path, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      'tool_error',
      new Date().toISOString(),
      's5',
      'test-project',
      '/Users/dev/test-project',
      JSON.stringify({
        tool: 'Bash',
        error: `Very long error message number ${i} with lots of details about what went wrong in the execution process`
      })
    );
  }

  db.close();

  const stdinData = {
    session_id: 's5',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-xyz',
    agent_type: 'executor-high'
  };

  const output = runHook(stdinData);
  const parsed = JSON.parse(output);

  assert.ok(parsed.hookSpecificOutput.additionalContext.length <= 500,
    `Context should be <= 500 chars, got ${parsed.hookSpecificOutput.additionalContext.length}`);
});

test('System disabled — no output', () => {
  setup();
  initDb().close();

  // Write config.json with enabled: false
  const configPath = join(GLOBAL_DIR, 'config.json');
  writeFileSync(configPath, JSON.stringify({ enabled: false }));

  const stdinData = {
    session_id: 's6',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-disabled',
    agent_type: 'executor'
  };

  const output = runHook(stdinData);
  assert.strictEqual(output, '', 'Should produce no output when system disabled');
});

test('Invalid JSON stdin — exits 0 without crash', () => {
  setup();
  initDb().close();

  const hookPath = join(process.cwd(), 'hooks', 'subagent-context.mjs');
  const env = { ...process.env, HOME: TEST_HOME };

  const result = execSync(`node ${hookPath}`, {
    input: '{invalid json',
    env,
    encoding: 'utf-8'
  });

  assert.strictEqual(result.trim(), '', 'Should produce no output on invalid JSON');
});

test('Compound agent type matching (oh-my-claudecode:executor-high)', () => {
  setup();
  const db = initDb();

  // Insert a simple error
  db.prepare(`
    INSERT INTO events (v, type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    'tool_error',
    new Date().toISOString(),
    's7',
    'test-project',
    '/Users/dev/test-project',
    JSON.stringify({ tool: 'Edit', error: 'File not found' })
  );

  db.close();

  const stdinData = {
    session_id: 's7',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-compound',
    agent_type: 'oh-my-claudecode:executor-high'
  };

  const output = runHook(stdinData);
  assert.ok(output.length > 0, 'Should match compound agent type');

  const parsed = JSON.parse(output);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('이 프로젝트의 최근 에러 패턴'));
});

test('Global rules (project: null) included with project rules', () => {
  setup();
  const db = initDb();

  const analysis = {
    suggestions: [
      { type: 'claude_md', project: 'test-project', rule: 'Project-specific rule' },
      { type: 'claude_md', project: null, rule: 'Global rule for all projects' },
      { type: 'claude_md', project: 'other-project', rule: 'Other project rule' } // Should be filtered
    ]
  };

  db.prepare(`
    INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    'test-project',
    7,
    'hash456',
    JSON.stringify(analysis)
  );

  db.close();

  const stdinData = {
    session_id: 's8',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-global',
    agent_type: 'designer'
  };

  const output = runHook(stdinData);
  const parsed = JSON.parse(output);

  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Project-specific rule'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Global rule for all projects'));
  assert.ok(!parsed.hookSpecificOutput.additionalContext.includes('Other project rule'));
});

test('Error without KB resolution — still displays error pattern', () => {
  setup();
  const db = initDb();

  db.prepare(`
    INSERT INTO events (v, type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    'tool_error',
    new Date().toISOString(),
    's9',
    'test-project',
    '/Users/dev/test-project',
    JSON.stringify({ tool: 'Bash', error: 'Unknown error occurred' })
  );

  // No error_kb entry for this error

  db.close();

  const stdinData = {
    session_id: 's9',
    cwd: '/Users/dev/test-project',
    agent_id: 'agent-no-kb',
    agent_type: 'executor'
  };

  const output = runHook(stdinData);
  const parsed = JSON.parse(output);

  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('이 프로젝트의 최근 에러 패턴'));
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Unknown error occurred'));
  assert.ok(!parsed.hookSpecificOutput.additionalContext.includes('해결:'));
});
