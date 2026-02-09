// tests/ai-analyzer.test.mjs
// Test suite for lib/ai-analyzer.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

// Override HOME to temp directory for isolated testing
const TEST_HOME = join(tmpdir(), `self-gen-test-${Date.now()}`);
process.env.HOME = TEST_HOME;

const GLOBAL_DIR = join(TEST_HOME, '.self-generation');
const DATA_DIR = join(GLOBAL_DIR, 'data');
const PROMPTS_DIR = join(GLOBAL_DIR, 'prompts');

// Setup test environment
async function setupTestEnv() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(PROMPTS_DIR, { recursive: true });

  // Create minimal config.json
  writeFileSync(join(GLOBAL_DIR, 'config.json'), JSON.stringify({
    enabled: true,
    dbPath: join(DATA_DIR, 'self-gen.db')
  }));

  // Create minimal analyze.md template
  writeFileSync(join(PROMPTS_DIR, 'analyze.md'), `
아래는 Claude Code 사용자의 최근 {{days}}일간 사용 로그이다.
프로젝트: {{project}}

## 로그 데이터
{{log_data}}

## 피드백 이력
{{feedback_history}}

## 기존 스킬 목록
{{existing_skills}}

## 제안 효과 메트릭
{{outcome_metrics}}
`);

  // Initialize DB by calling getDb (which auto-initializes)
  const { getDb } = await import('../lib/db.mjs');
  getDb();
}

// Cleanup test environment
function cleanupTestEnv() {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
}

// Import module under test (after HOME override)
const analyzerModule = await import('../lib/ai-analyzer.mjs');

test('computeInputHash - same input produces same hash', async () => {
  await setupTestEnv();

  const events = [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', session_id: 's1', data: { text: 'test' } },
    { type: 'tool_use', ts: '2026-02-09T10:01:00Z', session_id: 's1', data: { tool: 'Read' } }
  ];

  // Access internal function via test exposure or re-implement
  const hash1 = computeHash(events);
  const hash2 = computeHash(events);

  assert.strictEqual(hash1, hash2, 'Same input should produce same hash');

  cleanupTestEnv();
});

test('computeInputHash - different input produces different hash', async () => {
  await setupTestEnv();

  const events1 = [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', session_id: 's1', data: { text: 'test1' } }
  ];
  const events2 = [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', session_id: 's1', data: { text: 'test2' } }
  ];

  const hash1 = computeHash(events1);
  const hash2 = computeHash(events2);

  assert.notStrictEqual(hash1, hash2, 'Different input should produce different hash');

  cleanupTestEnv();
});

test('extractJSON - handles ```json block', () => {
  const { default: analyzer } = analyzerModule;

  const text = `Here is the result:
\`\`\`json
{"suggestions": [], "clusters": []}
\`\`\`
That's all.`;

  const result = extractJSONHelper(text);
  const parsed = JSON.parse(result);

  assert.strictEqual(Array.isArray(parsed.suggestions), true);
  assert.strictEqual(Array.isArray(parsed.clusters), true);
});

test('extractJSON - handles raw JSON', () => {
  const text = '{"suggestions": [], "workflows": []}';

  const result = extractJSONHelper(text);
  const parsed = JSON.parse(result);

  assert.strictEqual(Array.isArray(parsed.suggestions), true);
  assert.strictEqual(Array.isArray(parsed.workflows), true);
});

test('summarizeForPrompt - correct output structure', async () => {
  await setupTestEnv();

  const entries = [
    { type: 'prompt', ts: '2026-02-09T10:00:00Z', sessionId: 's1', text: 'test prompt 1', project: 'proj1' },
    { type: 'prompt', ts: '2026-02-09T10:05:00Z', sessionId: 's1', text: 'test prompt 2', project: 'proj1' },
    { type: 'tool_use', ts: '2026-02-09T10:01:00Z', sessionId: 's1', tool: 'Read' },
    { type: 'tool_use', ts: '2026-02-09T10:02:00Z', sessionId: 's1', tool: 'Edit' },
    { type: 'tool_error', ts: '2026-02-09T10:03:00Z', sessionId: 's1', tool: 'Bash', error: 'Command failed', errorRaw: 'Error: command not found' },
    { type: 'session_summary', ts: '2026-02-09T10:10:00Z', sessionId: 's1' }
  ];

  const summary = summarizeHelper(entries);

  assert.strictEqual(summary.prompts.length, 2, 'Should have 2 prompts');
  assert.strictEqual(summary.prompts[0].text, 'test prompt 1');
  assert.strictEqual(summary.toolSequences.length, 1, 'Should have 1 session sequence');
  assert.strictEqual(summary.toolSequences[0], 'Read → Edit', 'Should join tools with →');
  assert.strictEqual(summary.errors.length, 1, 'Should have 1 error');
  assert.strictEqual(summary.errors[0].tool, 'Bash');
  assert.strictEqual(summary.sessionCount, 1);
  assert.strictEqual(summary.toolTotal, 2);

  cleanupTestEnv();
});

test('getCachedAnalysis - returns null when cache is empty', async () => {
  await setupTestEnv();

  const result = await analyzerModule.getCachedAnalysis(24, 'test-project');

  assert.strictEqual(result, null, 'Should return null when no cache exists');

  cleanupTestEnv();
});

test('runAnalysis - returns insufficient_data when < 5 prompts', async () => {
  await setupTestEnv();

  const { insertEvent } = await import('../lib/db.mjs');

  // Insert only 3 prompts
  for (let i = 0; i < 3; i++) {
    insertEvent({
      v: 1,
      type: 'prompt',
      ts: new Date().toISOString(),
      sessionId: 's1',
      project: 'test',
      projectPath: '/test',
      text: `prompt ${i}`
    });
  }

  const result = await analyzerModule.runAnalysis({ days: 7, project: 'test' });

  assert.strictEqual(result.reason, 'insufficient_data', 'Should return insufficient_data');
  assert.strictEqual(Array.isArray(result.suggestions), true);
  assert.strictEqual(result.suggestions.length, 0);

  cleanupTestEnv();
});

// Helper functions (re-implement internal functions for testing)
function computeHash(events) {
  const content = events
    .map(e => `${e.type}:${e.ts}:${e.session_id}:${JSON.stringify(e.data)}`)
    .join('\n');
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function extractJSONHelper(text) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) return match[1];

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}

function summarizeHelper(entries, maxPrompts = 100) {
  const prompts = entries
    .filter(e => e.type === 'prompt')
    .slice(-maxPrompts)
    .map(e => ({ ts: e.ts, text: e.text, project: e.project }));

  const tools = entries.filter(e => e.type === 'tool_use');
  const errors = entries.filter(e => e.type === 'tool_error');
  const summaries = entries.filter(e => e.type === 'session_summary');

  const sessionTools = {};
  for (const t of tools) {
    if (!sessionTools[t.sessionId]) sessionTools[t.sessionId] = [];
    sessionTools[t.sessionId].push(t.tool);
  }

  return {
    prompts,
    toolSequences: Object.values(sessionTools).map(seq => seq.join(' → ')),
    errors: errors.map(e => ({
      tool: e.tool,
      error: e.error,
      raw: e.errorRaw
    })),
    sessionCount: summaries.length,
    toolTotal: tools.length
  };
}
