#!/usr/bin/env node
// ~/.self-generation/hooks/error-logger.mjs
// PostToolUseFailure hook — record tool errors + real-time KB search

import { insertEvent, getProjectName, getProjectPath, readStdin, isEnabled } from '../lib/db.mjs';
import { normalizeError, searchErrorKB } from '../lib/error-kb.mjs';

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);

  const normalized = normalizeError(input.error || '');

  // 1. Record error event
  const entry = {
    v: 1,
    type: 'tool_error',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(getProjectPath(input.cwd)),
    projectPath: getProjectPath(input.cwd),
    tool: input.tool_name,
    error: normalized,
    errorRaw: (input.error || '').slice(0, 500)
  };
  insertEvent(entry);

  // 2. Real-time KB search with 2s timeout
  const kbMatch = await Promise.race([
    searchErrorKB(normalized),
    new Promise(resolve => setTimeout(() => resolve(null), 2000))
  ]);

  if (kbMatch) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: (() => {
          let resText = kbMatch.resolution;
          try {
            const res = JSON.parse(kbMatch.resolution);
            resText = res.toolSequence
              ? `${res.resolvedBy}: ${res.toolSequence.join(' → ')}`
              : res.resolvedBy || kbMatch.resolution;
          } catch {
            // If resolution is not JSON, use as-is
          }
          return `[Self-Generation 에러 KB] 이전에 동일 에러를 해결한 이력이 있습니다:\n` +
            `- 에러: ${kbMatch.error_normalized}\n` +
            `- 해결 방법: ${resText}\n` +
            `이 정보를 참고하여 해결을 시도하세요.`;
        })()
      }
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
} catch (e) {
  // Non-blocking: exit 0 on any error
  process.exit(0);
}
