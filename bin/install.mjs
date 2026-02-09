#!/usr/bin/env node
// ~/.self-generation/bin/install.mjs
// Usage: node install.mjs [--uninstall [--purge]]
// v9: Automated install/uninstall script

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

const HOME = homedir();
const SELF_GEN_DIR = join(HOME, '.self-generation');
const SETTINGS_PATH = join(HOME, '.claude', 'settings.json');
const SOCKET_PATH = '/tmp/self-gen-embed.sock';
const isUninstall = process.argv.includes('--uninstall');
const isPurge = process.argv.includes('--purge');

const HOOK_EVENTS = {
  UserPromptSubmit: { script: 'prompt-logger.mjs', timeout: 5 },
  PostToolUse: { script: 'tool-logger.mjs', timeout: 5 },
  PostToolUseFailure: { script: 'error-logger.mjs', timeout: 5 },
  PreToolUse: { script: 'pre-tool-guide.mjs', matcher: 'Edit|Write|Bash|Task', timeout: 5 },
  SubagentStart: { script: 'subagent-context.mjs', timeout: 5 },
  SubagentStop: { script: 'subagent-tracker.mjs', timeout: 5 },
  SessionEnd: { script: 'session-summary.mjs', timeout: 10 },
  SessionStart: { script: 'session-analyzer.mjs', timeout: 10 }
};

// --purge without --uninstall: warn and proceed with install
if (isPurge && !isUninstall) {
  console.log('⚠️  --purge는 --uninstall과 함께 사용해야 합니다. 설치를 진행합니다.');
}

if (isUninstall) {
  // Remove hooks from settings.json (preserve other hooks)
  if (existsSync(SETTINGS_PATH)) {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    if (settings.hooks) {
      for (const event of Object.keys(HOOK_EVENTS)) {
        if (settings.hooks[event]) {
          settings.hooks[event] = settings.hooks[event].filter(
            group => !group.hooks?.some(h => h.command?.includes('.self-generation'))
          );
          if (settings.hooks[event].length === 0) delete settings.hooks[event];
        }
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    }
  }
  console.log('✅ self-generation 훅이 settings.json에서 제거되었습니다.');

  if (isPurge) {
    // Full removal: delete data directory and socket file
    if (existsSync(SELF_GEN_DIR)) {
      rmSync(SELF_GEN_DIR, { recursive: true, force: true });
    }
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
    console.log('🗑️  데이터 디렉토리와 소켓 파일이 삭제되었습니다.');
  } else {
    console.log(`   데이터 삭제: rm -rf ${SELF_GEN_DIR}`);
  }

  process.exit(0);
}

// --- Installation ---

// 1. Create directory structure
for (const dir of ['data', 'hooks', 'lib', 'bin', 'prompts']) {
  mkdirSync(join(SELF_GEN_DIR, dir), { recursive: true });
}
console.log('📁 디렉토리 구조 생성 완료');

// 2. Initialize package.json and install dependencies
if (!existsSync(join(SELF_GEN_DIR, 'package.json'))) {
  writeFileSync(join(SELF_GEN_DIR, 'package.json'), JSON.stringify({
    name: 'self-generation',
    version: '0.1.0',
    type: 'module',
    private: true,
    dependencies: {
      'better-sqlite3': '^11.0.0',
      'sqlite-vec': '^0.1.0',
      '@xenova/transformers': '^2.17.0'
    }
  }, null, 2));
}
console.log('📦 package.json 확인 완료');

// Skip npm install in test/CI environments
if (!process.env.SELF_GEN_SKIP_NPM) {
  try {
    execSync('npm install --production', { cwd: SELF_GEN_DIR, stdio: 'inherit' });
    console.log('📦 의존성 설치 완료');
  } catch (e) {
    console.error('❌ 의존성 설치 실패:', e.message);
    process.exit(1);
  }
} else {
  console.log('📦 의존성 설치 건너뜀 (SELF_GEN_SKIP_NPM)');
}

// 3. Initialize config.json
const configPath = join(SELF_GEN_DIR, 'config.json');
if (!existsSync(configPath)) {
  writeFileSync(configPath, JSON.stringify({
    enabled: true,
    collectPromptText: true,
    retentionDays: 90,
    analysisModel: 'claude-sonnet-4-5-20250929'
  }, null, 2));
  console.log('⚙️  config.json 초기화 완료');
}

// 4. Merge hooks into settings.json (preserve existing hooks)
mkdirSync(join(HOME, '.claude'), { recursive: true });
const settings = existsSync(SETTINGS_PATH)
  ? JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  : {};
if (!settings.hooks) settings.hooks = {};

for (const [event, config] of Object.entries(HOOK_EVENTS)) {
  const hookEntry = {
    type: 'command',
    command: `node ${join(SELF_GEN_DIR, 'hooks', config.script)}`,
    timeout: config.timeout
  };
  const group = { hooks: [hookEntry] };
  if (config.matcher) group.matcher = config.matcher;

  // Avoid duplicate registration
  if (!settings.hooks[event]) settings.hooks[event] = [];
  const alreadyRegistered = settings.hooks[event].some(
    g => g.hooks?.some(h => h.command?.includes('.self-generation'))
  );
  if (!alreadyRegistered) settings.hooks[event].push(group);
}

writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
console.log('🔗 settings.json에 훅 등록 완료');

console.log('\n✅ self-generation 설치가 완료되었습니다.');
