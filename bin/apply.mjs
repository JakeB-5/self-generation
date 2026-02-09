#!/usr/bin/env node
// ~/.self-generation/bin/apply.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';
import { recordFeedback } from '../lib/feedback-tracker.mjs';
import { insertEvent, getProjectName } from '../lib/db.mjs';

const args = process.argv.slice(2);
const num = parseInt(args[0]);
const isGlobal = args.includes('--global');
const isApply = args.includes('--apply');
const projectIdx = args.indexOf('--project');
const project = projectIdx !== -1 ? args[projectIdx + 1] : basename(process.cwd());

if (isNaN(num)) {
  console.error('사용법: node ~/.self-generation/bin/apply.mjs <번호> [--global]');
  process.exit(1);
}

const analysis = getCachedAnalysis(168, project);
if (!analysis || !analysis.suggestions?.length) {
  console.error('분석 결과가 없습니다. 먼저 node ~/.self-generation/bin/analyze.mjs 를 실행하세요.');
  process.exit(1);
}

const suggestions = analysis.suggestions;
if (num < 1 || num > suggestions.length) {
  console.error(`유효한 범위: 1-${suggestions.length}`);
  process.exit(1);
}

const suggestion = suggestions[num - 1];

switch (suggestion.type) {
  case 'skill':
    applySkill(suggestion);
    break;
  case 'claude_md':
    applyClaudeMd(suggestion);
    break;
  case 'hook': {
    const GLOBAL_DIR = join(process.env.HOME, '.self-generation');
    const hookDir = join(GLOBAL_DIR, 'hooks', 'auto');
    mkdirSync(hookDir, { recursive: true });
    const hookFile = join(hookDir, `workflow-${suggestion.id}.mjs`);
    if (suggestion.hookCode) {
      writeFileSync(hookFile, suggestion.hookCode);
      console.log(`✅ 훅 스크립트 생성됨: ${hookFile}`);

      if (isApply) {
        registerHook(hookFile, suggestion.hookEvent || 'PostToolUse', suggestion.id);
      } else {
        console.log(`\n수동 등록: ~/.claude/settings.json에 다음을 추가하세요:`);
        console.log(`  "${suggestion.hookEvent || 'PostToolUse'}": ["${hookFile}"]`);
        console.log(`\n또는 자동 등록: node ~/.self-generation/bin/apply.mjs ${num} --apply`);
      }
    } else {
      console.log('⚠️  훅 코드 미생성 — 프롬프트 템플릿에 hookCode 필드를 요청하세요');
    }
    break;
  }
}

recordFeedback(suggestion.id, 'accepted', {
  suggestionType: suggestion.type,
  summary: suggestion.summary
});

insertEvent({
  v: 1,
  type: suggestion.type === 'skill' ? 'skill_created' : 'suggestion_applied',
  ts: new Date().toISOString(),
  sessionId: 'cli',
  project: getProjectName(process.cwd()),
  projectPath: process.cwd(),
  data: { suggestionId: suggestion.id, suggestionType: suggestion.type, scope: isGlobal ? 'global' : 'project' }
});

function applySkill(suggestion) {
  const baseDir = isGlobal
    ? join(process.env.HOME, '.claude', 'commands')
    : join(process.cwd(), '.claude', 'commands');
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const name = suggestion.skillName || 'auto-skill';
  const filePath = join(baseDir, `${name}.md`);
  const content = [
    `# /${name}`, '',
    `AI가 감지한 반복 패턴에서 생성된 스킬입니다.`, '',
    '## 감지된 패턴',
    ...(suggestion.evidence ? [`- ${suggestion.evidence}`] : []), '',
    '## 실행 지침', '',
    suggestion.action || '$ARGUMENTS', ''
  ].join('\n');
  writeFileSync(filePath, content);
  console.log(`스킬 생성: ${filePath}`);
}

function applyClaudeMd(suggestion) {
  const claudeMdPath = isGlobal
    ? join(process.env.HOME, '.claude', 'CLAUDE.md')
    : join(process.cwd(), 'CLAUDE.md');
  const claudeDir = join(claudeMdPath, '..');
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
  const rule = suggestion.rule || suggestion.summary;
  let content = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf-8') : '';
  if (content.includes(rule)) { console.log('이미 동일한 규칙이 존재합니다.'); return; }
  if (!content.includes('## 자동 감지된 규칙')) content += '\n\n## 자동 감지된 규칙\n';
  content += `- ${rule}\n`;
  writeFileSync(claudeMdPath, content);
  console.log(`CLAUDE.md 업데이트: ${claudeMdPath}`);
}

function registerHook(hookFile, hookEvent, suggestionId) {
  const settingsPath = join(process.env.HOME, '.claude', 'settings.json');
  let settings = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.log('⚠️  settings.json 파싱 실패 — 수동으로 등록하세요');
      return;
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[hookEvent]) settings.hooks[hookEvent] = [];

  if (settings.hooks[hookEvent].includes(hookFile)) {
    console.log('이미 등록된 훅입니다.');
    return;
  }

  settings.hooks[hookEvent].push(hookFile);

  try {
    const settingsDir = join(settingsPath, '..');
    if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`✅ settings.json에 훅이 등록됨: ${hookEvent} → ${hookFile}`);
  } catch {
    console.log('⚠️  settings.json 쓰기 실패 — 수동으로 등록하세요');
  }
}
