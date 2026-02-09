#!/usr/bin/env node
// ~/.self-generation/bin/analyze.mjs
// CLI tool for on-demand AI pattern analysis

import { runAnalysis } from '../lib/ai-analyzer.mjs';

const args = process.argv.slice(2);
const days = parseInt(args.find((_, i, a) => a[i - 1] === '--days') || '30');
const project = args.find((_, i, a) => a[i - 1] === '--project') || null;
const projectPath = args.find((_, i, a) => a[i - 1] === '--project-path') || null;

console.log(`\n=== Self-Generation AI 패턴 분석 (최근 ${days}일) ===\n`);

const result = await runAnalysis({ days, project, projectPath });

if (result.error) {
  console.error(`분석 실패: ${result.error}`);
  process.exit(1);
}

if (result.reason === 'insufficient_data') {
  console.log('데이터 부족: 프롬프트 5개 이상 수집 후 다시 실행하세요.');
  process.exit(0);
}

// Display clusters
if (result.clusters?.length > 0) {
  console.log('--- 반복 프롬프트 클러스터 ---');
  for (const c of result.clusters) {
    console.log(`\n  [${c.count}회] ${c.intent} - ${c.summary}`);
    for (const ex of c.examples.slice(0, 3)) {
      console.log(`    "${ex}"`);
    }
  }
}

// Display workflows
if (result.workflows?.length > 0) {
  console.log('\n--- 반복 도구 시퀀스 ---');
  for (const w of result.workflows) {
    console.log(`  [${w.count}회] ${w.pattern} (${w.purpose})`);
  }
}

// Display error patterns
if (result.errorPatterns?.length > 0) {
  console.log('\n--- 반복 에러 패턴 ---');
  for (const ep of result.errorPatterns) {
    console.log(`  [${ep.count}회] ${ep.pattern}`);
    if (ep.proposedRule) console.log(`    → 규칙: "${ep.proposedRule}"`);
  }
}

// Display suggestions
if (result.suggestions?.length > 0) {
  console.log('\n=== 개선 제안 ===\n');
  for (let i = 0; i < result.suggestions.length; i++) {
    const s = result.suggestions[i];
    console.log(`${i + 1}. [${s.type}] ${s.summary}`);
    console.log(`   근거: ${s.evidence}`);
    console.log(`   제안: ${s.action}\n`);
  }
}

console.log('---');
console.log('제안을 적용하려면: node ~/.self-generation/bin/apply.mjs <번호>');
