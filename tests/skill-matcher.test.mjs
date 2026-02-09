// tests/skill-matcher.test.mjs
// Tests for lib/skill-matcher.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSkills, extractPatterns, matchSkill } from '../lib/skill-matcher.mjs';

// Create temp directory for tests
const testRoot = mkdtempSync(join(tmpdir(), 'skill-matcher-test-'));
const originalHome = process.env.HOME;

// Cleanup function
function cleanup() {
  rmSync(testRoot, { recursive: true, force: true });
  process.env.HOME = originalHome;
}

// Setup test environment with mock skills
function setupTestSkills() {
  // Override HOME for global skills
  process.env.HOME = testRoot;

  // Create global skills directory
  const globalDir = join(testRoot, '.claude', 'commands');
  mkdirSync(globalDir, { recursive: true });

  // Create global skill: deploy.md
  writeFileSync(join(globalDir, 'deploy.md'), `# Deploy Skill

Deploy application to production server.

## 감지된 패턴
- "deploy to production"
- "배포해줘"
- "서버에 올려줘"

## Usage
Run /deploy to deploy.
`);

  // Create global skill: docker-build.md
  writeFileSync(join(globalDir, 'docker-build.md'), `# Docker Build

Build and push Docker images.

## 감지된 패턴
- "docker build"
- "도커 이미지 빌드"
- "build image"
- "push image"

## Usage
Run /docker-build to build images.
`);

  // Create project directory with project skills
  const projectPath = join(testRoot, 'test-project');
  const projectDir = join(projectPath, '.claude', 'commands');
  mkdirSync(projectDir, { recursive: true });

  // Create project skill: test-api.md
  writeFileSync(join(projectDir, 'test-api.md'), `# Test API

Run API integration tests.

## 감지된 패턴
- "test api"
- "api 테스트"
- "integration test"

## Usage
Run /test-api for integration tests.
`);

  return { globalDir, projectPath, projectDir };
}

test('loadSkills - loads global and project skills', () => {
  const { projectPath } = setupTestSkills();

  const skills = loadSkills(projectPath);

  assert.strictEqual(skills.length, 3);

  const deploy = skills.find(s => s.name === 'deploy');
  assert.strictEqual(deploy.scope, 'global');
  assert.ok(deploy.content.includes('Deploy application'));
  assert.strictEqual(deploy.description, 'Deploy application to production server.');

  const dockerBuild = skills.find(s => s.name === 'docker-build');
  assert.strictEqual(dockerBuild.scope, 'global');

  const testApi = skills.find(s => s.name === 'test-api');
  assert.strictEqual(testApi.scope, 'project');
  assert.strictEqual(testApi.description, 'Run API integration tests.');

  cleanup();
});

test('loadSkills - returns empty array when directories do not exist', () => {
  process.env.HOME = join(testRoot, 'nonexistent');

  const skills = loadSkills(null);

  assert.strictEqual(skills.length, 0);

  cleanup();
});

test('loadSkills - loads only global skills when projectPath is null', () => {
  setupTestSkills();

  const skills = loadSkills(null);

  assert.strictEqual(skills.length, 2);
  assert.ok(skills.every(s => s.scope === 'global'));

  cleanup();
});

test('extractPatterns - extracts patterns from skill content', () => {
  const content = `# Test Skill

Description here.

## 감지된 패턴
- "docker build"
- "이미지 빌드"
- "build container"

## Usage
Some usage instructions.
`;

  const patterns = extractPatterns(content);

  assert.strictEqual(patterns.length, 3);
  assert.deepStrictEqual(patterns, ['docker build', '이미지 빌드', 'build container']);
});

test('extractPatterns - returns empty array when no pattern section', () => {
  const content = `# Test Skill

Description without patterns section.

## Usage
Some usage.
`;

  const patterns = extractPatterns(content);

  assert.strictEqual(patterns.length, 0);
});

test('extractPatterns - handles patterns without quotes', () => {
  const content = `# Test Skill

## 감지된 패턴
- deploy production
- test api
- build image

## Other
`;

  const patterns = extractPatterns(content);

  assert.strictEqual(patterns.length, 3);
  assert.deepStrictEqual(patterns, ['deploy production', 'test api', 'build image']);
});

test('matchSkill - keyword fallback matches with 50% threshold', async () => {
  const { projectPath } = setupTestSkills();
  const skills = loadSkills(projectPath);

  // Match "docker build" skill with prompt containing 3 of 4 keywords (75%)
  const result = await matchSkill('docker image build', skills);

  assert.ok(result);
  assert.strictEqual(result.name, 'docker-build');
  assert.strictEqual(result.match, 'keyword');
  assert.ok(result.confidence >= 0.5);
  assert.strictEqual(result.scope, 'global');

  cleanup();
});

test('matchSkill - keyword fallback fails below 50% threshold', async () => {
  const { projectPath } = setupTestSkills();
  const skills = loadSkills(projectPath);

  // "unrelated words here" - no meaningful match with any skill patterns
  const result = await matchSkill('compile typescript code', skills);

  // Should not match any skill (no 50%+ pattern match)
  assert.strictEqual(result, null);

  cleanup();
});

test('matchSkill - keyword matching is case-insensitive', async () => {
  const { projectPath } = setupTestSkills();
  const skills = loadSkills(projectPath);

  const result = await matchSkill('DOCKER BUILD IMAGE', skills);

  assert.ok(result);
  assert.strictEqual(result.name, 'docker-build');
  assert.strictEqual(result.match, 'keyword');

  cleanup();
});

test('matchSkill - returns null when no match', async () => {
  const { projectPath } = setupTestSkills();
  const skills = loadSkills(projectPath);

  const result = await matchSkill('unrelated query here', skills);

  assert.strictEqual(result, null);

  cleanup();
});

test('matchSkill - matches Korean patterns', async () => {
  const { projectPath } = setupTestSkills();
  const skills = loadSkills(projectPath);

  const result = await matchSkill('서버에 배포해줘', skills);

  assert.ok(result);
  assert.strictEqual(result.name, 'deploy');
  assert.strictEqual(result.match, 'keyword');

  cleanup();
});

test('matchSkill - filters words less than 3 characters', async () => {
  const { projectPath } = setupTestSkills();
  const skills = loadSkills(projectPath);

  // "test api" has both words >= 3 chars, should match
  const result = await matchSkill('test api integration', skills);

  assert.ok(result);
  assert.strictEqual(result.name, 'test-api');

  cleanup();
});
