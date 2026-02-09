// tests/analyze-cli.test.mjs
// Test suite for bin/analyze.mjs CLI tool

import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const CLI_PATH = join(process.cwd(), 'bin', 'analyze.mjs');

test('CLI script exists', () => {
  assert.strictEqual(existsSync(CLI_PATH), true, 'bin/analyze.mjs should exist');
});

test('CLI script has valid syntax', () => {
  try {
    execSync(`"${process.execPath}" --check "${CLI_PATH}"`, {
      encoding: 'utf-8'
    });
  } catch (e) {
    assert.fail(`CLI script has syntax errors: ${e.message}`);
  }
});

test('CLI script has shebang', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  const firstLine = content.split('\n')[0];
  assert.match(firstLine, /^#!.*node/, 'Should have node shebang');
});

test('CLI script is executable', () => {
  const stats = execSync(`stat -f %A "${CLI_PATH}"`, { encoding: 'utf-8' }).trim();
  // Check if user has execute permission (bit 6 set)
  const mode = parseInt(stats);
  const userExecute = (mode & 0o100) !== 0;
  assert.strictEqual(userExecute, true, 'CLI script should have user execute permission');
});

test('CLI script imports runAnalysis correctly', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /import.*runAnalysis.*from.*ai-analyzer/, 'Should import runAnalysis from ai-analyzer');
});

test('CLI script parses --days argument', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /--days/, 'Should handle --days argument');
  assert.match(content, /parseInt/, 'Should parse days as integer');
});

test('CLI script parses --project argument', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /--project/, 'Should handle --project argument');
});

test('CLI script parses --project-path argument', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /--project-path/, 'Should handle --project-path argument');
});

test('CLI script has default days value', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /'30'/, 'Should default to 30 days');
});

test('CLI script awaits runAnalysis', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /await runAnalysis/, 'Should await runAnalysis call');
});

test('CLI script handles insufficient_data', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /insufficient_data/, 'Should check for insufficient_data reason');
  assert.match(content, /프롬프트 5개 이상/, 'Should display Korean message for insufficient data');
});

test('CLI script handles errors', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /result\.error/, 'Should check for result.error');
  assert.match(content, /process\.exit\(1\)/, 'Should exit with code 1 on error');
});

test('CLI script displays clusters', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /result\.clusters/, 'Should check for clusters');
  assert.match(content, /반복 프롬프트 클러스터/, 'Should have Korean section header for clusters');
});

test('CLI script displays workflows', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /result\.workflows/, 'Should check for workflows');
  assert.match(content, /반복 도구 시퀀스/, 'Should have Korean section header for workflows');
});

test('CLI script displays error patterns', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /result\.errorPatterns/, 'Should check for errorPatterns');
  assert.match(content, /반복 에러 패턴/, 'Should have Korean section header for error patterns');
});

test('CLI script displays suggestions', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /result\.suggestions/, 'Should check for suggestions');
  assert.match(content, /개선 제안/, 'Should have Korean section header for suggestions');
});

test('CLI script shows apply.mjs usage hint', () => {
  const content = readFileSync(CLI_PATH, 'utf-8');
  assert.match(content, /apply\.mjs/, 'Should mention apply.mjs for applying suggestions');
});
