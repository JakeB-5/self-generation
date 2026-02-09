// Tests for config-schema (lib/db.mjs config functions)
// Uses Node.js built-in test runner (node:test)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test by spawning a subprocess with overridden HOME to isolate config
import { execSync } from 'child_process';

const TEST_HOME = join(tmpdir(), `config-test-${Date.now()}`);
const SELF_GEN_DIR = join(TEST_HOME, '.self-generation');
const CONFIG_PATH = join(SELF_GEN_DIR, 'config.json');

// Helper to run a script that imports and tests db.mjs functions
function runInSubprocess(code) {
  return execSync(`node -e "${code.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, HOME: TEST_HOME },
    encoding: 'utf-8',
    cwd: process.cwd(),
    timeout: 10000
  });
}

// Helper using eval-style test runner
function evalConfig(expr) {
  const code = `
    import { loadConfig, isEnabled, RETENTION_DAYS, ANALYSIS_DAYS, ANALYSIS_CACHE_MAX_AGE_HOURS, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_THRESHOLD, DEFAULT_BATCH_SIZE, DEFAULT_SOCKET_PATH, DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_CLIENT_TIMEOUT_MS } from './lib/db.mjs';
    const result = ${expr};
    process.stdout.write(JSON.stringify(result));
  `;
  const output = execSync(`node --input-type=module -e '${code.replace(/'/g, "'\\''")}'`, {
    env: { ...process.env, HOME: TEST_HOME },
    encoding: 'utf-8',
    cwd: process.cwd(),
    timeout: 10000
  });
  return JSON.parse(output);
}

describe('config-schema', () => {
  beforeEach(() => {
    mkdirSync(SELF_GEN_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe('loadConfig()', () => {
    it('should return parsed config when file exists', () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({
        enabled: true,
        retentionDays: 30
      }));
      const config = evalConfig('loadConfig()');
      assert.equal(config.enabled, true);
      assert.equal(config.retentionDays, 30);
    });

    it('should return {} when file does not exist', () => {
      // Don't create config.json
      rmSync(CONFIG_PATH, { force: true });
      const config = evalConfig('loadConfig()');
      assert.deepEqual(config, {});
    });

    it('should return {} on JSON parse error', () => {
      writeFileSync(CONFIG_PATH, 'not valid json {{{');
      const config = evalConfig('loadConfig()');
      assert.deepEqual(config, {});
    });
  });

  describe('isEnabled()', () => {
    it('should return false when enabled is false', () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ enabled: false }));
      const result = evalConfig('isEnabled()');
      assert.equal(result, false);
    });

    it('should return true when enabled is true', () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ enabled: true }));
      const result = evalConfig('isEnabled()');
      assert.equal(result, true);
    });

    it('should return true when enabled field is missing', () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ retentionDays: 30 }));
      const result = evalConfig('isEnabled()');
      assert.equal(result, true);
    });

    it('should return true when config.json does not exist', () => {
      rmSync(CONFIG_PATH, { force: true });
      const result = evalConfig('isEnabled()');
      assert.equal(result, true);
    });
  });

  describe('default constants (REQ-INF-104)', () => {
    it('should export correct default values', () => {
      writeFileSync(CONFIG_PATH, '{}');
      const constants = evalConfig(`({
        RETENTION_DAYS,
        ANALYSIS_DAYS,
        ANALYSIS_CACHE_MAX_AGE_HOURS,
        DEFAULT_EMBEDDING_MODEL,
        DEFAULT_EMBEDDING_DIMENSIONS,
        DEFAULT_EMBEDDING_THRESHOLD,
        DEFAULT_BATCH_SIZE,
        DEFAULT_SOCKET_PATH,
        DEFAULT_IDLE_TIMEOUT_MINUTES,
        DEFAULT_CLIENT_TIMEOUT_MS
      })`);
      assert.equal(constants.RETENTION_DAYS, 90);
      assert.equal(constants.ANALYSIS_DAYS, 7);
      assert.equal(constants.ANALYSIS_CACHE_MAX_AGE_HOURS, 24);
      assert.equal(constants.DEFAULT_EMBEDDING_MODEL, 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
      assert.equal(constants.DEFAULT_EMBEDDING_DIMENSIONS, 384);
      assert.equal(constants.DEFAULT_EMBEDDING_THRESHOLD, 0.76);
      assert.equal(constants.DEFAULT_BATCH_SIZE, 50);
      assert.equal(constants.DEFAULT_SOCKET_PATH, '/tmp/self-gen-embed.sock');
      assert.equal(constants.DEFAULT_IDLE_TIMEOUT_MINUTES, 30);
      assert.equal(constants.DEFAULT_CLIENT_TIMEOUT_MS, 10000);
    });
  });

  describe('partial config default merge (REQ-INF-105)', () => {
    it('should use OR pattern for missing fields', () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ retentionDays: 30 }));
      const result = evalConfig(`(() => {
        const config = loadConfig();
        return {
          retentionDays: config.retentionDays || RETENTION_DAYS,
          analysisDays: config.analysisDays || ANALYSIS_DAYS,
          cacheAge: config.analysisCacheMaxAgeHours || ANALYSIS_CACHE_MAX_AGE_HOURS
        };
      })()`);
      assert.equal(result.retentionDays, 30); // user value
      assert.equal(result.analysisDays, 7);   // default
      assert.equal(result.cacheAge, 24);       // default
    });

    it('should handle invalid type via falsy evaluation', () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ retentionDays: 'abc' }));
      const result = evalConfig(`(() => {
        const config = loadConfig();
        const val = config.retentionDays;
        return typeof val === 'number' && val > 0 ? val : RETENTION_DAYS;
      })()`);
      assert.equal(result, 90); // default fallback
    });
  });
});
