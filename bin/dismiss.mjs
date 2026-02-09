#!/usr/bin/env node
// ~/.self-generation/bin/dismiss.mjs
import { recordFeedback } from '../lib/feedback-tracker.mjs';

const args = process.argv.slice(2);
const suggestionId = args[0];

if (!suggestionId) {
  console.error('사용법: node ~/.self-generation/bin/dismiss.mjs <suggestion-id>');
  process.exit(1);
}

recordFeedback(suggestionId, 'rejected', {
  suggestionType: 'unknown'
});

console.log(`제안 거부 기록됨: ${suggestionId}`);
console.log('이 패턴은 향후 AI 분석 시 제외 컨텍스트로 전달됩니다.');
