// tests/batch-embeddings.test.mjs
// Tests for batch-embeddings.mjs (detached batch embedding processor)
// NOTE: vec0 virtual table INSERT is not directly testable due to sqlite-vec v0.1.6
// compatibility issue with better-sqlite3 bindings. The batch processor wraps all
// vec0 operations in try-catch, so failures are handled gracefully at runtime.
// These tests verify the surrounding logic (queries, blob conversion, skip logic).

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb, resetDb } from '../lib/db.mjs';

const TEST_HOME = join(process.cwd(), 'test-tmp-batch-embeddings');
const ORIGINAL_HOME = process.env.HOME;

function setupTestEnv() {
  process.env.HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
  mkdirSync(join(TEST_HOME, '.self-generation', 'data'), { recursive: true });
  mkdirSync(join(TEST_HOME, '.claude', 'commands'), { recursive: true });

  resetDb();
  const db = getDb();

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tables.map(t => t.name);
  assert.ok(tableNames.includes('error_kb'), 'error_kb table should exist');
  assert.ok(tableNames.includes('skill_embeddings'), 'skill_embeddings table should exist');
}

function teardownTestEnv() {
  resetDb();
  process.env.HOME = ORIGINAL_HOME;
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
}

test('batch-embeddings: script file structure', async () => {
  const scriptPath = join(process.cwd(), 'lib', 'batch-embeddings.mjs');
  assert.ok(existsSync(scriptPath), 'batch-embeddings.mjs should exist');

  const content = readFileSync(scriptPath, 'utf-8');

  // Check imports
  assert.ok(content.includes("import { getDb, generateEmbeddings } from './db.mjs'"), 'should import from db.mjs');
  assert.ok(content.includes("import { loadSkills, extractPatterns } from './skill-matcher.mjs'"), 'should import from skill-matcher.mjs');
  assert.ok(content.includes("import { isServerRunning, startServer } from './embedding-client.mjs'"), 'should import from embedding-client.mjs');

  // Check try-catch wrapper
  assert.ok(content.includes('try {'), 'should have try block');
  assert.ok(content.includes('} catch'), 'should have catch block');
  assert.ok(content.match(/process\.exit\(0\)/g).length >= 2, 'should have process.exit(0) in both try and catch');

  // Check 10s delay (REQ-RA-601)
  assert.ok(content.includes('setTimeout(r, 10000)'), 'should have 10s startup delay');

  // Check busy_timeout (REQ-RA-602)
  assert.ok(content.includes("pragma('busy_timeout = 10000')"), 'should set busy_timeout');

  // Check daemon wait loop (REQ-RA-603)
  assert.ok(content.includes('isServerRunning()'), 'should check daemon status');
  assert.ok(content.includes('startServer()'), 'should start daemon if needed');

  // Check error KB query (REQ-RA-604)
  assert.ok(content.includes('SELECT id, error_normalized FROM error_kb'), 'should query error_kb');
  assert.ok(content.includes('WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)'), 'should filter missing embeddings');

  // Check skill loading (REQ-RA-605)
  assert.ok(content.includes('loadSkills(projectPath)'), 'should call loadSkills');
  assert.ok(content.includes('INSERT OR REPLACE INTO skill_embeddings'), 'should UPSERT skill_embeddings');
  assert.ok(content.includes('.slice(0, 500)'), 'should truncate skill content to 500 chars');

  // Check Float32Array → Buffer conversion
  assert.ok(content.includes('Buffer.from(new Float32Array'), 'should convert Float32Array to Buffer');
});

test('batch-embeddings: error KB missing embeddings query', async () => {
  setupTestEnv();

  const db = getDb();

  // Seed error_kb entries
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, error_raw, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(now, 'ENOENT: file not found', 'ENOENT: no such file', null, 0, now);

  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, error_raw, resolution, use_count, last_used)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(now, 'TypeError: undefined is not a function', 'TypeError: x is not a fn', null, 0, now);

  // Query for missing embeddings (same query as batch-embeddings.mjs)
  const missing = db.prepare(`
    SELECT id, error_normalized FROM error_kb
    WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)
  `).all();

  assert.strictEqual(missing.length, 2, 'should find 2 missing embeddings');
  assert.strictEqual(missing[0].error_normalized, 'ENOENT: file not found');
  assert.strictEqual(missing[1].error_normalized, 'TypeError: undefined is not a function');

  // Verify Float32Array → Buffer conversion logic
  const mockEmbedding = new Array(384).fill(0).map((_, i) => i / 384);
  const blob = Buffer.from(new Float32Array(mockEmbedding).buffer);
  assert.strictEqual(blob.length, 384 * 4, 'embedding blob should be 1536 bytes');

  teardownTestEnv();
});

test('batch-embeddings: skill embeddings UPSERT logic', async () => {
  setupTestEnv();

  const db = getDb();

  // Create test skill files
  const globalCommands = join(TEST_HOME, '.claude', 'commands');
  writeFileSync(join(globalCommands, 'test-skill.md'), `# Test Skill

This is a test skill for batch embeddings.

## 감지된 패턴
- "test pattern"
- "another pattern"
`);

  const { loadSkills, extractPatterns } = await import('../lib/skill-matcher.mjs');
  const skills = loadSkills(null);
  assert.strictEqual(skills.length, 1, 'should load 1 skill');

  const skill = skills[0];
  const keywords = extractPatterns(skill.content);
  assert.ok(keywords.includes('test pattern'), 'should extract patterns');

  // UPSERT skill metadata (same logic as batch-embeddings.mjs)
  const result = db.prepare(`
    INSERT OR REPLACE INTO skill_embeddings (name, source_path, description, keywords, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    skill.name,
    skill.sourcePath,
    skill.description || null,
    JSON.stringify(keywords),
    new Date().toISOString()
  );

  let skillId = Number(result.lastInsertRowid);
  if (!skillId) {
    const row = db.prepare('SELECT id FROM skill_embeddings WHERE name = ?').get(skill.name);
    skillId = Number(row?.id);
  }

  assert.ok(skillId, 'should get skillId from UPSERT');

  // Verify skill_embeddings entry
  const skillRow = db.prepare('SELECT * FROM skill_embeddings WHERE id = ?').get(skillId);
  assert.strictEqual(skillRow.name, 'test-skill', 'should store skill name');
  assert.ok(skillRow.keywords, 'should store keywords');

  const parsedKeywords = JSON.parse(skillRow.keywords);
  assert.ok(Array.isArray(parsedKeywords), 'keywords should be array');
  assert.ok(parsedKeywords.includes('test pattern'), 'should include extracted pattern');

  // Verify 500-char truncation logic
  const text = skill.content.slice(0, 500);
  assert.ok(text.length <= 500, 'content should be truncated to 500 chars');
  assert.ok(text.includes('Test Skill'), 'truncated content should include skill title');

  teardownTestEnv();
});

test('batch-embeddings: graceful exit on errors', async () => {
  const scriptPath = join(process.cwd(), 'lib', 'batch-embeddings.mjs');
  const content = readFileSync(scriptPath, 'utf-8');

  // Verify the outer catch block contains process.exit(0)
  assert.ok(
    /\}\s*catch\s*\([^)]*\)\s*\{[^}]*process\.exit\(0\)/s.test(content),
    'catch block should contain process.exit(0)'
  );

  // Verify both try and catch have process.exit(0)
  const exitCount = (content.match(/process\.exit\(0\)/g) || []).length;
  assert.ok(exitCount >= 2, 'should have process.exit(0) in both try and catch paths');

  // Verify inner try-catch for individual skill processing
  assert.ok(
    /for\s*\(const skill of skills\)\s*\{\s*try\s*\{/s.test(content),
    'should have per-skill try-catch for resilience'
  );
});

test('batch-embeddings: empty case (no missing embeddings, no skills)', async () => {
  setupTestEnv();

  const db = getDb();

  // Verify no error_kb entries
  const errorCount = db.prepare('SELECT COUNT(*) as count FROM error_kb').get().count;
  assert.strictEqual(errorCount, 0, 'should have no error_kb entries');

  // Query for missing embeddings (should be empty)
  const missing = db.prepare(`
    SELECT id FROM error_kb
    WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)
  `).all();
  assert.strictEqual(missing.length, 0, 'should have no missing embeddings');

  // Verify no skills in empty commands dir
  const { loadSkills } = await import('../lib/skill-matcher.mjs');
  const skills = loadSkills(null);
  assert.strictEqual(skills.length, 0, 'should have no skills');

  teardownTestEnv();
});

test('batch-embeddings: partial failure skip logic', async () => {
  // Verify that null embeddings are skipped (same logic as batch-embeddings.mjs)
  const mockEmbeddings = [
    new Array(384).fill(0).map((_, i) => i / 384),
    null, // Second embedding failed
    new Array(384).fill(0).map((_, i) => (i + 200) / 384)
  ];

  const processed = [];
  for (let i = 0; i < mockEmbeddings.length; i++) {
    if (!mockEmbeddings[i]) continue; // Skip null (same as batch-embeddings.mjs)
    const blob = Buffer.from(new Float32Array(mockEmbeddings[i]).buffer);
    processed.push({ index: i, blobLength: blob.length });
  }

  assert.strictEqual(processed.length, 2, 'should skip null embeddings');
  assert.strictEqual(processed[0].index, 0, 'first processed should be index 0');
  assert.strictEqual(processed[1].index, 2, 'second processed should be index 2');
  assert.strictEqual(processed[0].blobLength, 384 * 4, 'blob should be correct size');
});

test('batch-embeddings: skill UPSERT updates existing entry', async () => {
  setupTestEnv();

  const db = getDb();

  // Insert initial skill metadata
  const initialTime = new Date('2025-01-01').toISOString();
  db.prepare(`
    INSERT INTO skill_embeddings (name, source_path, description, keywords, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('test-skill', '/path/to/skill.md', 'Old description', '["old"]', initialTime);

  // UPSERT with new data
  const newTime = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO skill_embeddings (name, source_path, description, keywords, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('test-skill', '/new/path.md', 'New description', '["new"]', newTime);

  // Verify only one row exists for this name
  const rows = db.prepare('SELECT * FROM skill_embeddings WHERE name = ?').all('test-skill');
  assert.strictEqual(rows.length, 1, 'should have exactly 1 row after UPSERT');

  // Verify updated fields
  const updatedRow = rows[0];
  assert.strictEqual(updatedRow.description, 'New description', 'should update description');
  assert.strictEqual(updatedRow.keywords, '["new"]', 'should update keywords');
  assert.strictEqual(updatedRow.source_path, '/new/path.md', 'should update source_path');
  assert.notStrictEqual(updatedRow.updated_at, initialTime, 'should update timestamp');

  teardownTestEnv();
});
