// Tests for lib/db.mjs — log-writer module
// Requires better-sqlite3 and sqlite-vec installed

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Override HOME before importing db.mjs
const TEST_HOME = join(tmpdir(), `db-test-${Date.now()}`);
const SELF_GEN_DIR = join(TEST_HOME, '.self-generation');
mkdirSync(join(SELF_GEN_DIR, 'data'), { recursive: true });
process.env.HOME = TEST_HOME;

// Import db.mjs after HOME is set
const db = await import('../lib/db.mjs');

describe('log-writer (db.mjs)', () => {
  let conn;

  before(() => {
    conn = db.getDb();
  });

  after(() => {
    try { conn.close(); } catch { /* ignore */ }
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe('getDb()', () => {
    it('should return a db connection', () => {
      assert.ok(conn, 'should return a db connection');
    });

    it('should create all required tables', () => {
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map(r => r.name);

      assert.ok(tables.includes('events'), 'events table');
      assert.ok(tables.includes('error_kb'), 'error_kb table');
      assert.ok(tables.includes('feedback'), 'feedback table');
      assert.ok(tables.includes('analysis_cache'), 'analysis_cache table');
      assert.ok(tables.includes('skill_embeddings'), 'skill_embeddings table');
      assert.ok(tables.includes('events_fts'), 'events_fts virtual table');
    });

    it('should create vec0 virtual tables', () => {
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_%'"
      ).all().map(r => r.name);

      assert.ok(tables.includes('vec_error_kb'), 'vec_error_kb table');
      assert.ok(tables.includes('vec_skill_embeddings'), 'vec_skill_embeddings table');
    });

    it('should set WAL journal mode', () => {
      const mode = conn.pragma('journal_mode', { simple: true });
      assert.equal(mode, 'wal');
    });

    it('should create required indexes', () => {
      const indexes = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
      ).all().map(r => r.name);

      assert.ok(indexes.includes('idx_events_session'), 'idx_events_session');
      assert.ok(indexes.includes('idx_events_project_type'), 'idx_events_project_type');
      assert.ok(indexes.includes('idx_events_type_ts'), 'idx_events_type_ts');
      assert.ok(indexes.includes('idx_events_session_type'), 'idx_events_session_type');
      assert.ok(indexes.includes('idx_error_kb_error'), 'idx_error_kb_error');
      assert.ok(indexes.includes('idx_analysis_cache_hash'), 'idx_analysis_cache_hash');
    });

    it('should create FTS triggers', () => {
      const triggers = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
      ).all().map(r => r.name);

      assert.ok(triggers.includes('events_fts_insert'), 'fts insert trigger');
      assert.ok(triggers.includes('events_fts_delete'), 'fts delete trigger');
      assert.ok(triggers.includes('events_no_update'), 'no update trigger');
    });

    it('should return singleton connection', () => {
      const conn2 = db.getDb();
      assert.equal(conn, conn2);
    });
  });

  describe('insertEvent() + queryEvents()', () => {
    before(() => {
      // Seed test data
      const base = { project: 'proj', projectPath: '/proj' };
      db.insertEvent({ ...base, type: 'prompt', ts: '2026-01-01T00:00:00Z', sessionId: 's1', text: 'first' });
      db.insertEvent({ ...base, type: 'prompt', ts: '2026-01-02T00:00:00Z', sessionId: 's1', text: 'second' });
      db.insertEvent({ ...base, type: 'tool_error', ts: '2026-01-03T00:00:00Z', sessionId: 's2', error: 'fail' });
    });

    it('should insert and query events', () => {
      const events = db.queryEvents({ type: 'prompt' });
      assert.ok(events.length >= 2);
    });

    it('should default v to 1', () => {
      const events = db.queryEvents({ type: 'prompt', limit: 1 });
      assert.equal(events[0].v, 1);
    });

    it('should filter by type', () => {
      const events = db.queryEvents({ type: 'tool_error' });
      assert.ok(events.length >= 1);
      assert.equal(events[0].type, 'tool_error');
    });

    it('should filter by sessionId', () => {
      const events = db.queryEvents({ sessionId: 's2' });
      assert.ok(events.length >= 1);
      assert.equal(events[0].type, 'tool_error');
    });

    it('should filter by projectPath', () => {
      const events = db.queryEvents({ projectPath: '/proj' });
      assert.ok(events.length >= 3);
    });

    it('should filter by since', () => {
      const events = db.queryEvents({ since: '2026-01-02T00:00:00Z', projectPath: '/proj' });
      assert.ok(events.length >= 2);
    });

    it('should apply limit', () => {
      const events = db.queryEvents({ limit: 1 });
      assert.equal(events.length, 1);
    });

    it('should order by ts DESC', () => {
      const events = db.queryEvents({ projectPath: '/proj' });
      for (let i = 1; i < events.length; i++) {
        assert.ok(events[i - 1].ts >= events[i].ts, 'should be DESC order');
      }
    });

    it('should reconstruct flat entry format', () => {
      const events = db.queryEvents({ type: 'prompt', limit: 1 });
      const e = events[0];
      assert.ok('text' in e, 'data fields spread to top level');
      assert.ok('sessionId' in e, 'sessionId present');
      assert.ok('project' in e, 'project present');
      assert.ok('projectPath' in e, 'projectPath present');
    });

    it('should support FTS5 search', () => {
      const events = db.queryEvents({ search: 'first' });
      assert.ok(events.length >= 1);
      assert.equal(events[0].text, 'first');
    });
  });

  describe('getSessionEvents()', () => {
    it('should return events for a session', () => {
      db.insertEvent({
        type: 'prompt', ts: new Date().toISOString(),
        sessionId: 'sess-get', project: 'p', projectPath: '/p', text: 'x'
      });
      const events = db.getSessionEvents('sess-get');
      assert.equal(events.length, 1);
      assert.equal(events[0].sessionId, 'sess-get');
    });
  });

  describe('pruneOldEvents()', () => {
    it('should delete events older than retention days', () => {
      const old = new Date(Date.now() - 200 * 86400000).toISOString();
      db.insertEvent({ type: 'prompt', ts: old, sessionId: 'prune-s', project: 'prune-p', projectPath: '/prune', text: 'very-old' });

      const before = db.queryEvents({ sessionId: 'prune-s' });
      assert.equal(before.length, 1);

      db.pruneOldEvents(90);

      const after = db.queryEvents({ sessionId: 'prune-s' });
      assert.equal(after.length, 0);
    });
  });

  describe('getProjectName()', () => {
    it('should extract last directory component', () => {
      assert.equal(db.getProjectName('/Users/user/projects/my-app'), 'my-app');
    });

    it('should return unknown for null', () => {
      assert.equal(db.getProjectName(null), 'unknown');
    });
  });

  describe('getProjectPath()', () => {
    it('should prefer CLAUDE_PROJECT_DIR', () => {
      process.env.CLAUDE_PROJECT_DIR = '/override/path';
      assert.equal(db.getProjectPath('/cwd'), '/override/path');
      delete process.env.CLAUDE_PROJECT_DIR;
    });

    it('should fallback to cwd', () => {
      delete process.env.CLAUDE_PROJECT_DIR;
      assert.equal(db.getProjectPath('/cwd'), '/cwd');
    });
  });

  describe('stripPrivateTags()', () => {
    it('should strip private tags', () => {
      assert.equal(
        db.stripPrivateTags('hello <private>secret</private> world'),
        'hello [PRIVATE] world'
      );
    });

    it('should handle multiline private tags', () => {
      assert.equal(
        db.stripPrivateTags('a <private>\nline1\nline2\n</private> b'),
        'a [PRIVATE] b'
      );
    });

    it('should return null/undefined as-is', () => {
      assert.equal(db.stripPrivateTags(null), null);
      assert.equal(db.stripPrivateTags(undefined), undefined);
    });

    it('should be case-insensitive', () => {
      assert.equal(
        db.stripPrivateTags('test <PRIVATE>hidden</PRIVATE> end'),
        'test [PRIVATE] end'
      );
    });
  });

  describe('constants', () => {
    it('should export VEC_TABLE_REGISTRY', () => {
      assert.ok(db.VEC_TABLE_REGISTRY.error_kb);
      assert.equal(db.VEC_TABLE_REGISTRY.error_kb.vecTable, 'vec_error_kb');
      assert.equal(db.VEC_TABLE_REGISTRY.error_kb.fkColumn, 'error_kb_id');
      assert.ok(db.VEC_TABLE_REGISTRY.skill_embeddings);
      assert.equal(db.VEC_TABLE_REGISTRY.skill_embeddings.fkColumn, 'skill_id');
    });
  });

  describe('events_no_update trigger', () => {
    it('should prevent UPDATE on events table', () => {
      db.insertEvent({
        type: 'prompt', ts: new Date().toISOString(),
        sessionId: 'no-update', project: 'p', projectPath: '/p', text: 'test'
      });
      assert.throws(() => {
        conn.prepare("UPDATE events SET type = 'modified' WHERE session_id = 'no-update'").run();
      }, /INSERT-only/);
    });
  });
});
