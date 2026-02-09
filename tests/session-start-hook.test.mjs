// tests/session-start-hook.test.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.join(__dirname, '../hooks/session-analyzer.mjs');

// Helper: run hook with overridden HOME
async function runHook(stdin, testHome) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [HOOK_PATH], {
      env: { ...process.env, HOME: testHome },
      timeout: 5000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);

    proc.stdin.write(JSON.stringify(stdin));
    proc.stdin.end();
  });
}

// Helper: setup test environment
function setupTestEnv() {
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-test-'));
  const selfGenDir = path.join(testHome, '.self-generation');
  const dataDir = path.join(selfGenDir, 'data');
  const libDir = path.join(selfGenDir, 'lib');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  // Copy lib modules
  const projectLibDir = path.join(__dirname, '../lib');
  for (const file of ['db.mjs', 'ai-analyzer.mjs', 'embedding-client.mjs']) {
    const src = path.join(projectLibDir, file);
    const dest = path.join(libDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // Create config.json (enabled by default)
  fs.writeFileSync(
    path.join(selfGenDir, 'config.json'),
    JSON.stringify({ enabled: true, version: 1 })
  );

  return { testHome, selfGenDir, dataDir };
}

// Helper: cleanup test environment
function cleanupTestEnv(testHome) {
  fs.rmSync(testHome, { recursive: true, force: true });
}

// Helper: seed database with events
async function seedDatabase(dataDir, events) {
  const Database = (await import('better-sqlite3')).default;
  const dbPath = path.join(dataDir, 'self-gen.db');
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      project TEXT NOT NULL,
      project_path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      data TEXT NOT NULL,
      v INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_events_type_project_ts ON events(type, project_path, ts DESC);
  `);

  const stmt = db.prepare(`
    INSERT INTO events (ts, type, project, project_path, session_id, data, v)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  for (const event of events) {
    stmt.run(
      event.ts || new Date().toISOString(),
      event.type,
      event.project || 'test-project',
      event.project_path || '/test/project',
      event.session_id || 'test-session',
      JSON.stringify(event.data || {})
    );
  }

  db.close();
}

// Helper: seed analysis cache
async function seedAnalysisCache(dataDir, cacheEntry) {
  const Database = (await import('better-sqlite3')).default;
  const dbPath = path.join(dataDir, 'self-gen.db');
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      project TEXT,
      days INTEGER,
      input_hash TEXT,
      analysis JSON NOT NULL
    );
  `);

  const stmt = db.prepare(`
    INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Build analysis JSON with suggestions
  const analysis = {
    summary: cacheEntry.summary || '',
    suggestions: cacheEntry.suggestions || []
  };

  stmt.run(
    cacheEntry.ts || new Date().toISOString(),
    cacheEntry.project || 'test-project',
    cacheEntry.days || 7,
    cacheEntry.input_hash || 'test-hash',
    JSON.stringify(analysis)
  );

  db.close();
}

describe('session-start-hook (hooks/session-analyzer.mjs)', () => {
  describe('REQ-SSH-001: System enabled check', () => {
    it('should exit 0 with no output when system is disabled', async () => {
      const { testHome, selfGenDir } = setupTestEnv();

      // Disable system
      fs.writeFileSync(
        path.join(selfGenDir, 'config.json'),
        JSON.stringify({ enabled: false, version: 1 })
      );

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);
      assert.equal(stdout, '');

      cleanupTestEnv(testHome);
    });

    it('should continue execution when system is enabled', async () => {
      const { testHome, selfGenDir } = setupTestEnv();

      // System enabled by default in setupTestEnv
      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code } = await runHook(stdin, testHome);

      assert.equal(code, 0);
      // No assertion on stdout - just checking it doesn't exit early

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-002: Cached analysis injection', () => {
    it('should inject suggestions from valid cache', async () => {
      const { testHome, dataDir } = setupTestEnv();

      // Seed cache with recent analysis (2 hours ago)
      // Note: getProjectName('/test/project') returns 'project' (last segment)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await seedAnalysisCache(dataDir, {
        ts: twoHoursAgo,
        project: 'project', // Must match getProjectName(cwd) result
        summary: 'Test summary',
        suggestions: [
          { type: 'skill', summary: 'TS 프로젝트 초기화', id: 'suggest-0' },
          { type: 'directive', summary: '린트 규칙 추가', id: 'suggest-1' },
          { type: 'hook', summary: '빌드 자동화', id: 'suggest-2' },
          { type: 'skill', summary: '테스트 자동화', id: 'suggest-3' },
          { type: 'directive', summary: '포맷팅 규칙', id: 'suggest-4' }
        ]
      });

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);

      const output = JSON.parse(stdout);
      assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');

      const context = output.hookSpecificOutput.additionalContext;
      assert.match(context, /\[Self-Generation\] AI 패턴 분석 결과:/);
      assert.match(context, /\[skill\] TS 프로젝트 초기화 \[id: suggest-0\]/);
      assert.match(context, /\[directive\] 린트 규칙 추가 \[id: suggest-1\]/);
      assert.match(context, /\[hook\] 빌드 자동화 \[id: suggest-2\]/);
      // Should only show first 3
      assert.doesNotMatch(context, /suggest-3/);
      assert.doesNotMatch(context, /suggest-4/);

      cleanupTestEnv(testHome);
    });

    it('should not inject when cache is empty', async () => {
      const { testHome, dataDir } = setupTestEnv();

      // Create empty database
      await seedDatabase(dataDir, []);

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);
      assert.equal(stdout, ''); // No output when no cache and no previous session

      cleanupTestEnv(testHome);
    });

    it('should not inject when cache is expired (>24h)', async () => {
      const { testHome, dataDir } = setupTestEnv();

      // Seed cache with old analysis (30 hours ago)
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      await seedAnalysisCache(dataDir, {
        ts: thirtyHoursAgo,
        project: 'project', // Must match getProjectName(cwd)
        summary: 'Old summary',
        suggestions: [
          { type: 'skill', summary: 'Old suggestion', id: 'suggest-0' }
        ]
      });

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);
      assert.equal(stdout, ''); // No output - cache expired

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-003: Suggestion message formatting', () => {
    it('should format suggestions with type, summary, id, and CLI instructions', async () => {
      const { testHome, dataDir } = setupTestEnv();

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await seedAnalysisCache(dataDir, {
        ts: oneHourAgo,
        project: 'project', // Must match getProjectName(cwd)
        summary: 'Test',
        suggestions: [
          { type: 'skill', summary: 'TS 프로젝트 초기화 스킬', id: 'suggest-0' }
        ]
      });

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);

      const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      assert.match(context, /\[Self-Generation\] AI 패턴 분석 결과:/);
      assert.match(context, /- \[skill\] TS 프로젝트 초기화 스킬 \[id: suggest-0\]/);
      assert.match(context, /node ~\/.self-generation\/bin\/apply\.mjs <번호>/);
      assert.match(context, /node ~\/.self-generation\/bin\/dismiss\.mjs <id>/);

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-004: Previous session context injection', () => {
    it('should inject previous session summary', async () => {
      const { testHome, dataDir } = setupTestEnv();

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await seedDatabase(dataDir, [
        {
          ts: oneHourAgo,
          type: 'session_summary',
          project: 'test-project',
          project_path: '/test/project',
          session_id: 'prev-session',
          data: {
            promptCount: 15,
            toolCounts: { Read: 30, Edit: 20, Bash: 10 },
            lastPrompts: ['테스트 작성해줘'],
            lastEditedFiles: ['src/app.ts'],
            errorCount: 2,
            uniqueErrors: ['TypeError: x is not a function', 'RangeError: Invalid array length']
          }
        }
      ]);

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'new-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);

      const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      assert.match(context, /\[Self-Generation\] 이전 세션 컨텍스트/);
      assert.match(context, /프롬프트 15개, 도구 60회 사용/);
      assert.match(context, /이전 세션 마지막 작업: "테스트 작성해줘"/);
      assert.match(context, /수정 중이던 파일: src\/app\.ts/);
      assert.match(context, /미해결 에러 2건: TypeError: x is not a function, RangeError: Invalid array length/);
      assert.match(context, /주요 도구: Read\(30\), Edit\(20\), Bash\(10\)/);

      cleanupTestEnv(testHome);
    });

    it('should not inject when no previous session exists', async () => {
      const { testHome, dataDir } = setupTestEnv();

      await seedDatabase(dataDir, []); // Empty database

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'new-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);
      assert.equal(stdout, ''); // No cache, no previous session

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-005: Resume session detection', () => {
    it('should inject [RESUME] tag with detailed errors on resume', async () => {
      const { testHome, dataDir } = setupTestEnv();

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await seedDatabase(dataDir, [
        {
          ts: oneHourAgo,
          type: 'session_summary',
          project: 'test-project',
          project_path: '/test/project',
          session_id: 'prev-session',
          data: {
            promptCount: 10,
            toolCounts: { Bash: 5 },
            errorCount: 2,
            uniqueErrors: ['TypeError: x is not a function', 'SyntaxError: Unexpected token']
          }
        }
      ]);

      const stdin = {
        source: 'resume', // Resume session
        model: 'opus',
        session_id: 'resumed-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);

      const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      assert.match(context, /\[RESUME\] 미해결 에러 상세: TypeError: x is not a function, SyntaxError: Unexpected token/);

      cleanupTestEnv(testHome);
    });

    it('should not inject [RESUME] tag on regular startup', async () => {
      const { testHome, dataDir } = setupTestEnv();

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await seedDatabase(dataDir, [
        {
          ts: oneHourAgo,
          type: 'session_summary',
          project: 'test-project',
          project_path: '/test/project',
          session_id: 'prev-session',
          data: {
            promptCount: 10,
            toolCounts: { Bash: 5 },
            errorCount: 2,
            uniqueErrors: ['TypeError: x is not a function']
          }
        }
      ]);

      const stdin = {
        source: 'startup', // Regular startup
        model: 'opus',
        session_id: 'new-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);

      const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
      assert.doesNotMatch(context, /\[RESUME\]/);
      assert.match(context, /미해결 에러 2건/); // Still shows error count, just not [RESUME] tag

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-006: Embedding daemon auto-start', () => {
    it('should attempt to start embedding daemon if not running', async () => {
      const { testHome } = setupTestEnv();

      // Note: We can't fully test daemon startup without mocking,
      // but we can verify the hook completes without error
      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code } = await runHook(stdin, testHome);

      assert.equal(code, 0); // Should exit cleanly even if daemon fails to start

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-007: stdout output and exit', () => {
    it('should output JSON with hookSpecificOutput when context exists', async () => {
      const { testHome, dataDir } = setupTestEnv();

      // Seed both cache and previous session
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await seedAnalysisCache(dataDir, {
        ts: oneHourAgo,
        project: 'project', // Must match getProjectName(cwd)
        summary: 'Test',
        suggestions: [
          { type: 'skill', summary: 'Test suggestion', id: 'suggest-0' }
        ]
      });

      await seedDatabase(dataDir, [
        {
          ts: oneHourAgo,
          type: 'session_summary',
          project: 'project', // Must match getProjectName(cwd)
          project_path: '/test/project',
          session_id: 'prev-session',
          data: {
            promptCount: 5,
            toolCounts: { Read: 10 }
          }
        }
      ]);

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);

      const output = JSON.parse(stdout);
      assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
      assert.ok(output.hookSpecificOutput.additionalContext);

      // Should contain both parts joined by \n\n
      const context = output.hookSpecificOutput.additionalContext;
      assert.match(context, /AI 패턴 분석 결과/);
      assert.match(context, /이전 세션 컨텍스트/);

      cleanupTestEnv(testHome);
    });

    it('should output nothing when contextParts is empty', async () => {
      const { testHome, dataDir } = setupTestEnv();

      await seedDatabase(dataDir, []); // No data

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code, stdout } = await runHook(stdin, testHome);

      assert.equal(code, 0);
      assert.equal(stdout, '');

      cleanupTestEnv(testHome);
    });
  });

  describe('REQ-SSH-008: Hook failure safety', () => {
    it('should exit 0 when database is corrupted', async () => {
      const { testHome, dataDir } = setupTestEnv();

      // Create corrupted database
      fs.writeFileSync(path.join(dataDir, 'self-gen.db'), 'CORRUPTED DATA');

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code } = await runHook(stdin, testHome);

      assert.equal(code, 0); // Should still exit 0

      cleanupTestEnv(testHome);
    });

    it('should exit 0 when module load fails', async () => {
      const { testHome, selfGenDir } = setupTestEnv();

      // Remove lib directory to cause import failure
      fs.rmSync(path.join(selfGenDir, 'lib'), { recursive: true, force: true });

      const stdin = {
        source: 'startup',
        model: 'opus',
        session_id: 'test-session',
        cwd: '/test/project'
      };

      const { code } = await runHook(stdin, testHome);

      assert.equal(code, 0); // Should still exit 0

      cleanupTestEnv(testHome);
    });

    it('should exit 0 on invalid JSON stdin', async () => {
      const { testHome } = setupTestEnv();

      const proc = spawn('node', [HOOK_PATH], {
        env: { ...process.env, HOME: testHome },
        timeout: 5000
      });

      let code = null;
      proc.on('close', (c) => { code = c; });

      proc.stdin.write('INVALID JSON{{{');
      proc.stdin.end();

      await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      assert.equal(code, 0);

      cleanupTestEnv(testHome);
    });
  });
});
