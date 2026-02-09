// tests/feedback-tracker.test.mjs
// Tests for lib/feedback-tracker.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Override HOME before importing db.mjs
const testHome = mkdtempSync(join(tmpdir(), 'feedback-test-'));
process.env.HOME = testHome;

// Now import modules
const { getDb, insertEvent } = await import('../lib/db.mjs');
const { recordFeedback, getFeedbackSummary } = await import('../lib/feedback-tracker.mjs');

test('recordFeedback inserts correctly', () => {
  const db = getDb();

  recordFeedback('test-suggestion-1', 'accepted', {
    suggestionType: 'skill',
    summary: 'Add custom skill'
  });

  const row = db.prepare('SELECT * FROM feedback WHERE suggestion_id = ?').get('test-suggestion-1');

  assert.strictEqual(row.suggestion_id, 'test-suggestion-1');
  assert.strictEqual(row.action, 'accepted');
  assert.strictEqual(row.suggestion_type, 'skill');
  assert.strictEqual(row.summary, 'Add custom skill');
  assert.strictEqual(row.v, 1);
  assert.ok(row.ts);
});

test('recordFeedback handles missing details', () => {
  const db = getDb();

  recordFeedback('test-suggestion-2', 'rejected');

  const row = db.prepare('SELECT * FROM feedback WHERE suggestion_id = ?').get('test-suggestion-2');

  assert.strictEqual(row.action, 'rejected');
  assert.strictEqual(row.suggestion_type, null);
  assert.strictEqual(row.summary, null);
});

test('getFeedbackSummary returns null on empty', async () => {
  const db = getDb();
  db.prepare('DELETE FROM feedback').run();

  const summary = await getFeedbackSummary();
  assert.strictEqual(summary, null);
});

test('getFeedbackSummary with mixed feedback', async () => {
  const db = getDb();
  db.prepare('DELETE FROM feedback').run();

  // Insert test data
  recordFeedback('s1', 'accepted', { summary: 'Skill 1' });
  recordFeedback('s2', 'accepted', { summary: 'Skill 2' });
  recordFeedback('s3', 'rejected', { summary: 'Rule 1' });
  recordFeedback('s4', 'dismissed', { summary: 'Hook 1' });
  recordFeedback('s5', 'accepted', { summary: 'Skill 3' });

  const summary = await getFeedbackSummary();

  assert.strictEqual(summary.total, 5);
  assert.strictEqual(summary.acceptedCount, 3);
  assert.strictEqual(summary.rejectedCount, 2);
  assert.strictEqual(summary.rate, 3/5);

  assert.ok(Array.isArray(summary.recentRejections));
  assert.ok(summary.recentRejections.includes('Rule 1'));
  assert.ok(summary.recentRejections.includes('Hook 1'));

  assert.ok(Array.isArray(summary.recentAcceptances));
  assert.ok(summary.recentAcceptances.includes('Skill 1'));
  assert.ok(summary.recentAcceptances.includes('Skill 3'));
});

test('getFeedbackSummary includes recent lists (last 10)', async () => {
  const db = getDb();
  db.prepare('DELETE FROM feedback').run();

  // Insert 12 rejected items
  for (let i = 1; i <= 12; i++) {
    recordFeedback(`r${i}`, 'rejected', { summary: `Reject ${i}` });
  }

  const summary = await getFeedbackSummary();

  // Should only have last 10
  assert.strictEqual(summary.recentRejections.length, 10);
  assert.ok(summary.recentRejections.includes('Reject 12'));
  assert.ok(!summary.recentRejections.includes('Reject 1'));
  assert.ok(!summary.recentRejections.includes('Reject 2'));
});

test('calcSkillUsageRate via getFeedbackSummary', async () => {
  const db = getDb();
  db.prepare('DELETE FROM events').run();
  db.prepare('DELETE FROM feedback').run();

  // Insert skill events
  insertEvent({
    type: 'skill_created',
    ts: new Date().toISOString(),
    sessionId: 'test-session',
    project: 'test',
    projectPath: '/test'
  });

  insertEvent({
    type: 'skill_created',
    ts: new Date().toISOString(),
    sessionId: 'test-session',
    project: 'test',
    projectPath: '/test'
  });

  insertEvent({
    type: 'skill_used',
    ts: new Date().toISOString(),
    sessionId: 'test-session',
    project: 'test',
    projectPath: '/test'
  });

  // Add at least one feedback to trigger summary
  recordFeedback('s1', 'accepted');

  const summary = await getFeedbackSummary();

  // 1 used / 2 created = 0.5
  assert.strictEqual(summary.skillUsageRate, 0.5);
});

test('calcSkillUsageRate returns null when no skills created', async () => {
  const db = getDb();
  db.prepare('DELETE FROM events').run();
  db.prepare('DELETE FROM feedback').run();

  recordFeedback('s1', 'accepted');

  const summary = await getFeedbackSummary();
  assert.strictEqual(summary.skillUsageRate, null);
});

test('calcRuleEffectiveness via getFeedbackSummary', async () => {
  const db = getDb();
  db.prepare('DELETE FROM events').run();
  db.prepare('DELETE FROM feedback').run();

  // Insert old error (8 days ago)
  const oldDate = new Date(Date.now() - 8 * 86400000).toISOString();
  insertEvent({
    type: 'tool_error',
    ts: oldDate,
    sessionId: 'test-session',
    project: 'test',
    projectPath: '/test'
  });

  // Insert recent error (2 days ago)
  const recentDate = new Date(Date.now() - 2 * 86400000).toISOString();
  insertEvent({
    type: 'tool_error',
    ts: recentDate,
    sessionId: 'test-session',
    project: 'test',
    projectPath: '/test'
  });

  insertEvent({
    type: 'tool_error',
    ts: new Date().toISOString(),
    sessionId: 'test-session',
    project: 'test',
    projectPath: '/test'
  });

  recordFeedback('s1', 'accepted');

  const summary = await getFeedbackSummary();

  assert.strictEqual(summary.ruleEffectiveness.totalErrors, 3);
  assert.strictEqual(summary.ruleEffectiveness.recentErrors, 2);
});

test('findStaleSkills returns empty when skill-matcher not available', async () => {
  const db = getDb();
  db.prepare('DELETE FROM feedback').run();

  recordFeedback('s1', 'accepted');

  const summary = await getFeedbackSummary();

  // skill-matcher.mjs doesn't exist yet, should return []
  assert.ok(Array.isArray(summary.staleSkills));
  assert.strictEqual(summary.staleSkills.length, 0);
});

// Cleanup
test.after(() => {
  rmSync(testHome, { recursive: true, force: true });
});
