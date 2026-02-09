// tests/suggestion-cli.test.mjs
// Test suite for bin/apply.mjs and bin/dismiss.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

const TEST_HOME = join(process.cwd(), 'tests', 'fixtures', 'suggestion-cli-home');
const APPLY_SCRIPT = join(process.cwd(), 'bin', 'apply.mjs');
const DISMISS_SCRIPT = join(process.cwd(), 'bin', 'dismiss.mjs');

describe('Suggestion CLI Tests', () => {
  before(() => {
    // Setup test HOME with pre-seeded DB
    rmSync(TEST_HOME, { recursive: true, force: true });
    mkdirSync(join(TEST_HOME, '.self-generation', 'data'), { recursive: true });

    const dbPath = join(TEST_HOME, '.self-generation', 'data', 'self-gen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create minimal schema
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        v INTEGER DEFAULT 1,
        type TEXT NOT NULL,
        ts TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project TEXT,
        project_path TEXT,
        data JSON NOT NULL
      );
      CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        v INTEGER DEFAULT 1,
        ts TEXT NOT NULL,
        suggestion_id TEXT NOT NULL,
        action TEXT NOT NULL,
        suggestion_type TEXT,
        summary TEXT
      );
      CREATE TABLE analysis_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        project TEXT,
        days INTEGER,
        input_hash TEXT,
        analysis JSON NOT NULL
      );
      CREATE UNIQUE INDEX idx_analysis_cache_hash ON analysis_cache(project, days, input_hash);
    `);

    // Seed analysis_cache with sample suggestions
    const analysis = {
      suggestions: [
        {
          id: 'skill-001',
          type: 'skill',
          skillName: 'test-skill',
          summary: 'Test skill suggestion',
          evidence: 'Repeated pattern detected',
          action: 'Run test command'
        },
        {
          id: 'claude-001',
          type: 'claude_md',
          summary: 'Always use strict mode',
          rule: 'Always use strict mode in TypeScript'
        },
        {
          id: 'hook-001',
          type: 'hook',
          summary: 'Auto-format on save',
          hookCode: '#!/usr/bin/env node\nconsole.log("hook");'
        }
      ]
    };

    db.prepare(`
      INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      'test-project',
      7,
      'test-hash',
      JSON.stringify(analysis)
    );

    db.close();
  });

  after(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('dismiss.mjs: records rejection feedback', () => {
    const result = execSync(`node ${DISMISS_SCRIPT} test-suggestion-123`, {
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf-8'
    });

    assert.match(result, /제안 거부 기록됨: test-suggestion-123/);
    assert.match(result, /향후 AI 분석 시 제외 컨텍스트로 전달됩니다/);

    // Verify DB record
    const dbPath = join(TEST_HOME, '.self-generation', 'data', 'self-gen.db');
    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM feedback WHERE suggestion_id = ?')
      .get('test-suggestion-123');
    assert.strictEqual(row.action, 'rejected');
    db.close();
  });

  it('dismiss.mjs: no args → error message + exit 1', () => {
    try {
      execSync(`node ${DISMISS_SCRIPT}`, {
        env: { ...process.env, HOME: TEST_HOME },
        encoding: 'utf-8'
      });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.strictEqual(e.status, 1);
      assert.match(e.stderr, /사용법:/);
    }
  });

  it('apply.mjs: no args → error message + exit 1', () => {
    const projectDir = join(TEST_HOME, 'test-project');
    mkdirSync(projectDir, { recursive: true });

    try {
      execSync(`node ${APPLY_SCRIPT}`, {
        env: { ...process.env, HOME: TEST_HOME },
        encoding: 'utf-8',
        cwd: projectDir
      });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.strictEqual(e.status, 1);
      assert.match(e.stderr, /사용법:/);
    }
  });

  it('apply.mjs: no cached analysis → error message', () => {
    const projectDir = join(TEST_HOME, 'empty-project');
    mkdirSync(projectDir, { recursive: true });

    // Clear analysis cache
    const dbPath = join(TEST_HOME, '.self-generation', 'data', 'self-gen.db');
    const db = new Database(dbPath);
    db.prepare('DELETE FROM analysis_cache').run();
    db.close();

    try {
      execSync(`node ${APPLY_SCRIPT} 1`, {
        env: { ...process.env, HOME: TEST_HOME },
        encoding: 'utf-8',
        cwd: projectDir
      });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.strictEqual(e.status, 1);
      assert.match(e.stderr, /분석 결과가 없습니다/);
    }

    // Restore analysis cache for subsequent tests
    const db2 = new Database(dbPath);
    const analysis = {
      suggestions: [
        {
          id: 'skill-001',
          type: 'skill',
          skillName: 'test-skill',
          summary: 'Test skill suggestion',
          evidence: 'Repeated pattern detected',
          action: 'Run test command'
        },
        {
          id: 'claude-001',
          type: 'claude_md',
          summary: 'Always use strict mode',
          rule: 'Always use strict mode in TypeScript'
        },
        {
          id: 'hook-001',
          type: 'hook',
          summary: 'Auto-format on save',
          hookCode: '#!/usr/bin/env node\nconsole.log("hook");'
        }
      ]
    };
    db2.prepare(`
      INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      'test-project',
      7,
      'test-hash',
      JSON.stringify(analysis)
    );
    db2.close();
  });

  it('apply.mjs: apply skill suggestion → creates .md file', () => {
    const projectDir = join(TEST_HOME, 'test-project');
    mkdirSync(projectDir, { recursive: true });

    const result = execSync(`node ${APPLY_SCRIPT} 1`, {
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf-8',
      cwd: projectDir
    });

    assert.match(result, /스킬 생성:/);

    // Verify file created
    const skillFile = join(projectDir, '.claude', 'commands', 'test-skill.md');
    assert.ok(existsSync(skillFile));
    const content = readFileSync(skillFile, 'utf-8');
    assert.match(content, /# \/test-skill/);
    assert.match(content, /Repeated pattern detected/);
    assert.match(content, /Run test command/);

    // Verify feedback recorded
    const dbPath = join(TEST_HOME, '.self-generation', 'data', 'self-gen.db');
    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM feedback WHERE suggestion_id = ?')
      .get('skill-001');
    assert.strictEqual(row.action, 'accepted');
    db.close();
  });

  it('apply.mjs: apply claude_md suggestion → updates CLAUDE.md', () => {
    const projectDir = join(TEST_HOME, 'test-project');

    const result = execSync(`node ${APPLY_SCRIPT} 2`, {
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf-8',
      cwd: projectDir
    });

    assert.match(result, /CLAUDE\.md 업데이트:/);

    // Verify file updated
    const claudeFile = join(projectDir, 'CLAUDE.md');
    assert.ok(existsSync(claudeFile));
    const content = readFileSync(claudeFile, 'utf-8');
    assert.match(content, /## 자동 감지된 규칙/);
    assert.match(content, /Always use strict mode in TypeScript/);

    // Verify feedback recorded
    const dbPath = join(TEST_HOME, '.self-generation', 'data', 'self-gen.db');
    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM feedback WHERE suggestion_id = ?')
      .get('claude-001');
    assert.strictEqual(row.action, 'accepted');
    db.close();
  });

  it('apply.mjs: out of range number → error', () => {
    const projectDir = join(TEST_HOME, 'test-project');

    try {
      execSync(`node ${APPLY_SCRIPT} 99`, {
        env: { ...process.env, HOME: TEST_HOME },
        encoding: 'utf-8',
        cwd: projectDir
      });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.strictEqual(e.status, 1);
      assert.match(e.stderr, /유효한 범위:/);
    }
  });

  it('apply.mjs: apply hook suggestion → creates hook file', () => {
    const projectDir = join(TEST_HOME, 'test-project');

    const result = execSync(`node ${APPLY_SCRIPT} 3`, {
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf-8',
      cwd: projectDir
    });

    assert.match(result, /훅 스크립트 생성됨/);
    assert.match(result, /수동 등록:/);

    // Verify hook file created
    const hookFile = join(TEST_HOME, '.self-generation', 'hooks', 'auto', 'workflow-hook-001.mjs');
    assert.ok(existsSync(hookFile));
    const content = readFileSync(hookFile, 'utf-8');
    assert.match(content, /console\.log\("hook"\)/);
  });

  it('apply.mjs: apply hook with --apply → registers in settings.json', () => {
    const projectDir = join(TEST_HOME, 'test-project');

    // Create a fresh hook suggestion for this test
    const dbPath = join(TEST_HOME, '.self-generation', 'data', 'self-gen.db');
    const db = new Database(dbPath);
    db.prepare('DELETE FROM analysis_cache').run();

    const analysis = {
      suggestions: [
        {
          id: 'hook-002',
          type: 'hook',
          summary: 'Auto-format hook',
          hookCode: '#!/usr/bin/env node\nconsole.log("format");',
          hookEvent: 'PostToolUse'
        }
      ]
    };

    db.prepare(`
      INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      'test-project',
      7,
      'test-hash-2',
      JSON.stringify(analysis)
    );
    db.close();

    const result = execSync(`node ${APPLY_SCRIPT} 1 --apply`, {
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf-8',
      cwd: projectDir
    });

    assert.match(result, /훅 스크립트 생성됨/);
    assert.match(result, /settings\.json에 훅이 등록됨/);

    // Verify settings.json updated
    const settingsPath = join(TEST_HOME, '.claude', 'settings.json');
    assert.ok(existsSync(settingsPath));
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.ok(settings.hooks);
    assert.ok(settings.hooks.PostToolUse);
    assert.ok(settings.hooks.PostToolUse.some(h => h.includes('workflow-hook-002.mjs')));
  });
});
