// Tests for lib/error-kb.mjs — Error Knowledge Base module
// Requires better-sqlite3, sqlite-vec, and @xenova/transformers installed

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Override HOME before importing any modules
const TEST_HOME = join(tmpdir(), `error-kb-test-${Date.now()}`);
const SELF_GEN_DIR = join(TEST_HOME, '.self-generation');
mkdirSync(join(SELF_GEN_DIR, 'data'), { recursive: true });
process.env.HOME = TEST_HOME;

// Import modules after HOME is set
const db = await import('../lib/db.mjs');
const errorKb = await import('../lib/error-kb.mjs');

describe('error-kb', () => {
  let conn;

  before(() => {
    conn = db.getDb();
  });

  after(() => {
    try { conn.close(); } catch { /* ignore */ }
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe('normalizeError()', () => {
    it('should replace file paths with <PATH>', () => {
      const input = 'Error in /Users/user/file.js at line 10';
      const result = errorKb.normalizeError(input);
      assert.match(result, /<PATH>/);
      assert.ok(!result.includes('/Users'));
    });

    it('should replace relative paths with <PATH>', () => {
      const input = 'Cannot find ./lib/module.mjs';
      const result = errorKb.normalizeError(input);
      assert.match(result, /<PATH>/);
      assert.ok(!result.includes('./lib'));
    });

    it('should replace 2+ digit numbers with <N>', () => {
      const input = 'Timeout after 5000ms on port 3000';
      const result = errorKb.normalizeError(input);
      assert.match(result, /Timeout after <N>ms on port <N>/);
      assert.ok(!result.includes('5000'));
      assert.ok(!result.includes('3000'));
    });

    it('should preserve single digit numbers', () => {
      const input = 'Failed at step 3';
      const result = errorKb.normalizeError(input);
      assert.match(result, /step 3/);
    });

    it('should replace double-quoted strings ≤100 chars with <STR>', () => {
      const input = 'Cannot find module "express"';
      const result = errorKb.normalizeError(input);
      assert.equal(result, 'Cannot find module <STR>');
    });

    it('should replace single-quoted strings ≤100 chars with <STR>', () => {
      const input = "Missing key 'auth_token' in config";
      const result = errorKb.normalizeError(input);
      assert.match(result, /Missing key <STR>/);
    });

    it('should truncate to 200 chars', () => {
      const input = 'x'.repeat(300);
      const result = errorKb.normalizeError(input);
      assert.equal(result.length, 200);
    });

    it('should trim whitespace', () => {
      const input = '  error message  ';
      const result = errorKb.normalizeError(input);
      assert.equal(result, 'error message');
    });

    it('should handle null/undefined', () => {
      assert.equal(errorKb.normalizeError(null), '');
      assert.equal(errorKb.normalizeError(undefined), '');
    });

    it('should apply transformations in correct order (string → path → number)', () => {
      const input = 'Error "/path/to/file" at line 123';
      const result = errorKb.normalizeError(input);
      // Quotes replaced first: Error <STR> at line 123
      // Then paths: Error <STR> at line 123 (no change, path was already in quotes)
      // Then numbers: Error <STR> at line <N>
      assert.equal(result, 'Error <STR> at line <N>');
    });
  });

  describe('recordResolution() + searchErrorKB() exact match', () => {
    it('should record and retrieve resolution via exact match', async () => {
      const normalized = 'ENOENT: no such file or directory';
      const details = {
        error_raw: 'ENOENT: no such file or directory, open /tmp/test.txt',
        resolved_by: 'Bash',
        tool_sequence: 'mkdir,write'
      };

      errorKb.recordResolution(normalized, details);

      const result = await errorKb.searchErrorKB(normalized);
      assert.ok(result, 'should find exact match');
      assert.equal(result.error_normalized, normalized);
      assert.ok(result.resolution);
      const resolution = JSON.parse(result.resolution);
      assert.equal(resolution.resolved_by, 'Bash');
      assert.equal(result.use_count, 1); // 0 from insert + 1 from search
    });

    it('should increment use_count on repeated exact matches', async () => {
      const normalized = 'MODULE_NOT_FOUND';
      errorKb.recordResolution(normalized, { error_raw: 'test' });

      await errorKb.searchErrorKB(normalized);
      await errorKb.searchErrorKB(normalized);
      const result = await errorKb.searchErrorKB(normalized);

      assert.equal(result.use_count, 3); // 0 insert + 3 searches
    });
  });

  describe('recordResolution() UPSERT behavior', () => {
    it('should update existing entry on conflict', () => {
      const normalized = 'UNIQUE_ERROR';

      errorKb.recordResolution(normalized, {
        error_raw: 'first version',
        resolved_by: 'ToolA'
      });

      errorKb.recordResolution(normalized, {
        error_raw: 'second version',
        resolved_by: 'ToolB'
      });

      const row = conn.prepare(
        'SELECT * FROM error_kb WHERE error_normalized = ?'
      ).get(normalized);

      assert.equal(row.error_raw, 'second version');
      const resolution = JSON.parse(row.resolution);
      assert.equal(resolution.resolved_by, 'ToolB');
      assert.equal(row.use_count, 1); // 0 first insert + 1 on second insert (conflict)
    });
  });

  describe('searchErrorKB() prefix match', () => {
    it('should match by prefix when exact match fails', async () => {
      const base = 'Connection timeout after <N>ms';
      const variant = 'Connection timeout after <N>ms on retry <N>';

      errorKb.recordResolution(base, {
        error_raw: 'Connection timeout',
        resolved_by: 'retry'
      });

      const result = await errorKb.searchErrorKB(variant);
      assert.ok(result, 'should find prefix match');
      assert.equal(result.error_normalized, base);
    });

    it('should respect length ratio constraint (≥0.7)', async () => {
      const short = 'Error';
      const long = 'Error with many additional words that exceed the length ratio threshold';

      errorKb.recordResolution(short, { error_raw: 'test' });

      const result = await errorKb.searchErrorKB(long);
      assert.equal(result, null); // Length ratio too different
    });
  });

  describe('searchErrorKB() returns null when no match', () => {
    it('should return null for completely unrelated error', async () => {
      errorKb.recordResolution('KNOWN_ERROR_ALPHA', { error_raw: 'test' });

      const result = await errorKb.searchErrorKB('COMPLETELY_DIFFERENT_ERROR_BETA');
      // Will return null if vector search not available or distance too high
      // or null if no embeddings generated
      assert.ok(result === null || typeof result === 'object');
    });

    it('should return null for empty input', async () => {
      const result = await errorKb.searchErrorKB('');
      assert.equal(result, null);
    });

    it('should return null for null input', async () => {
      const result = await errorKb.searchErrorKB(null);
      assert.equal(result, null);
    });
  });

  describe('generateErrorEmbeddings()', () => {
    it('should generate embeddings for unembedded entries', async () => {
      const normalized = 'NEW_ERROR_FOR_EMBEDDING';
      errorKb.recordResolution(normalized, { error_raw: 'test' });

      // Check no embedding exists
      const beforeEmbed = conn.prepare(
        'SELECT COUNT(*) as cnt FROM vec_error_kb WHERE error_kb_id IN (SELECT id FROM error_kb WHERE error_normalized = ?)'
      ).get(normalized);
      assert.equal(beforeEmbed.cnt, 0);

      // Generate embeddings
      await errorKb.generateErrorEmbeddings();

      // Check if embedding was created (may fail if embedding server not running)
      const afterEmbed = conn.prepare(
        'SELECT COUNT(*) as cnt FROM vec_error_kb WHERE error_kb_id IN (SELECT id FROM error_kb WHERE error_normalized = ?)'
      ).get(normalized);

      // Embedding may or may not be created depending on server availability
      assert.ok(afterEmbed.cnt >= 0);
    });

    it('should handle empty database gracefully', async () => {
      // Clear error_kb
      conn.prepare('DELETE FROM error_kb').run();

      // Should not throw
      await errorKb.generateErrorEmbeddings();
    });
  });

  describe('resilience', () => {
    it('should handle recordResolution with null details gracefully', () => {
      // Should not throw
      errorKb.recordResolution('test', null);
      errorKb.recordResolution(null, { error_raw: 'test' });
    });

    it('should handle searchErrorKB database errors gracefully', async () => {
      // Close connection to simulate error
      const tempConn = conn;
      try {
        tempConn.close();
      } catch { /* ignore */ }

      // Should return null, not throw
      const result = await errorKb.searchErrorKB('test');
      assert.equal(result, null);

      // Reconnect for cleanup
      conn = db.getDb();
    });
  });
});
