// Tests for bin/install.mjs
// Uses Node.js built-in test runner (node:test)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const TEST_HOME = join(tmpdir(), `self-gen-test-${Date.now()}`);
const SELF_GEN_DIR = join(TEST_HOME, '.self-generation');
const CLAUDE_DIR = join(TEST_HOME, '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const INSTALL_SCRIPT = join(process.cwd(), 'bin', 'install.mjs');

// Wrapper to run install.mjs with overridden HOME and skipped npm install
function runInstall(args = '') {
  return execSync(`node ${INSTALL_SCRIPT} ${args}`, {
    env: { ...process.env, HOME: TEST_HOME, SELF_GEN_SKIP_NPM: '1' },
    encoding: 'utf-8',
    timeout: 30000
  });
}

function readJSON(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('install-cli', () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe('--install (default)', () => {
    it('should create 5 subdirectories', () => {
      runInstall();
      for (const dir of ['data', 'hooks', 'lib', 'bin', 'prompts']) {
        assert.ok(existsSync(join(SELF_GEN_DIR, dir)), `${dir} should exist`);
      }
    });

    it('should create package.json with correct content', () => {
      runInstall();
      const pkg = readJSON(join(SELF_GEN_DIR, 'package.json'));
      assert.equal(pkg.name, 'self-generation');
      assert.equal(pkg.version, '0.1.0');
      assert.equal(pkg.type, 'module');
      assert.equal(pkg.private, true);
      assert.ok(pkg.dependencies['better-sqlite3']);
      assert.ok(pkg.dependencies['sqlite-vec']);
      assert.ok(pkg.dependencies['@xenova/transformers']);
    });

    it('should create config.json with defaults', () => {
      runInstall();
      const config = readJSON(join(SELF_GEN_DIR, 'config.json'));
      assert.equal(config.enabled, true);
      assert.equal(config.collectPromptText, true);
      assert.equal(config.retentionDays, 90);
      assert.equal(config.analysisModel, 'claude-sonnet-4-5-20250929');
    });

    it('should register 8 hooks in settings.json', () => {
      runInstall();
      const settings = readJSON(SETTINGS_PATH);
      const events = [
        'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure',
        'PreToolUse', 'SubagentStart', 'SubagentStop',
        'SessionEnd', 'SessionStart'
      ];
      for (const event of events) {
        assert.ok(settings.hooks[event], `${event} hook should exist`);
        assert.ok(settings.hooks[event].length > 0, `${event} should have entries`);
      }
    });

    it('should set correct timeouts (5s normal, 10s session)', () => {
      runInstall();
      const settings = readJSON(SETTINGS_PATH);
      // Normal hooks: timeout 5
      for (const event of ['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SubagentStart', 'SubagentStop']) {
        const hook = settings.hooks[event][0].hooks[0];
        assert.equal(hook.timeout, 5, `${event} timeout should be 5`);
      }
      // Session hooks: timeout 10
      for (const event of ['SessionEnd', 'SessionStart']) {
        const hook = settings.hooks[event][0].hooks[0];
        assert.equal(hook.timeout, 10, `${event} timeout should be 10`);
      }
    });

    it('should set matcher for PreToolUse', () => {
      runInstall();
      const settings = readJSON(SETTINGS_PATH);
      const preToolGroup = settings.hooks.PreToolUse[0];
      assert.equal(preToolGroup.matcher, 'Edit|Write|Bash|Task');
    });
  });

  describe('idempotency', () => {
    it('should not duplicate hooks on re-run', () => {
      runInstall();
      runInstall();
      const settings = readJSON(SETTINGS_PATH);
      // Each event should have exactly 1 hook group
      for (const event of Object.keys(settings.hooks)) {
        const selfGenGroups = settings.hooks[event].filter(
          g => g.hooks?.some(h => h.command?.includes('.self-generation'))
        );
        assert.equal(selfGenGroups.length, 1, `${event} should have exactly 1 self-gen group`);
      }
    });

    it('should not overwrite existing package.json', () => {
      runInstall();
      // Modify package.json
      const pkgPath = join(SELF_GEN_DIR, 'package.json');
      const pkg = readJSON(pkgPath);
      pkg.version = '99.0.0';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      // Re-run install
      runInstall();
      const pkg2 = readJSON(pkgPath);
      assert.equal(pkg2.version, '99.0.0', 'version should be preserved');
    });

    it('should not overwrite existing config.json', () => {
      runInstall();
      const cfgPath = join(SELF_GEN_DIR, 'config.json');
      const cfg = readJSON(cfgPath);
      cfg.retentionDays = 999;
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      runInstall();
      const cfg2 = readJSON(cfgPath);
      assert.equal(cfg2.retentionDays, 999, 'retentionDays should be preserved');
    });
  });

  describe('existing hooks preservation', () => {
    it('should preserve other hooks in settings.json', () => {
      // Pre-create settings.json with existing hooks
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(SETTINGS_PATH, JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: 'command', command: 'node /other/hook.mjs' }] }
          ]
        }
      }, null, 2));
      runInstall();
      const settings = readJSON(SETTINGS_PATH);
      // Should have 2 groups: existing + self-generation
      assert.equal(settings.hooks.UserPromptSubmit.length, 2);
      assert.ok(
        settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('/other/hook.mjs'),
        'existing hook preserved'
      );
    });
  });

  describe('--uninstall', () => {
    it('should remove self-generation hooks only', () => {
      // Pre-create with mixed hooks
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(SETTINGS_PATH, JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: 'command', command: 'node /other/hook.mjs' }] },
            { hooks: [{ type: 'command', command: 'node /home/.self-generation/hooks/prompt-logger.mjs' }] }
          ]
        }
      }, null, 2));
      runInstall('--uninstall');
      const settings = readJSON(SETTINGS_PATH);
      assert.equal(settings.hooks.UserPromptSubmit.length, 1);
      assert.ok(settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('/other/hook.mjs'));
    });

    it('should delete empty event arrays', () => {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(SETTINGS_PATH, JSON.stringify({
        hooks: {
          SessionEnd: [
            { hooks: [{ type: 'command', command: 'node /home/.self-generation/hooks/session-summary.mjs' }] }
          ]
        }
      }, null, 2));
      runInstall('--uninstall');
      const settings = readJSON(SETTINGS_PATH);
      assert.equal(settings.hooks.SessionEnd, undefined, 'empty event key should be deleted');
    });

    it('should preserve data directory without --purge', () => {
      mkdirSync(SELF_GEN_DIR, { recursive: true });
      writeFileSync(join(SELF_GEN_DIR, 'test.txt'), 'data');
      runInstall('--uninstall');
      assert.ok(existsSync(SELF_GEN_DIR), 'data directory should be preserved');
    });

    it('should handle missing settings.json gracefully', () => {
      const output = runInstall('--uninstall');
      assert.ok(output.includes('제거'), 'should show removal message');
    });
  });

  describe('--uninstall --purge', () => {
    it('should delete data directory', () => {
      mkdirSync(join(SELF_GEN_DIR, 'data'), { recursive: true });
      writeFileSync(join(SELF_GEN_DIR, 'data', 'test.db'), 'data');
      runInstall('--uninstall --purge');
      assert.ok(!existsSync(SELF_GEN_DIR), 'data directory should be deleted');
    });

    it('--purge without --uninstall should warn and proceed', () => {
      const output = runInstall('--purge');
      assert.ok(output.includes('--uninstall과 함께'), 'should show warning');
      // Should still install
      assert.ok(existsSync(SELF_GEN_DIR), 'should proceed with install');
    });
  });
});
