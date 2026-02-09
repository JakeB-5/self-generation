// ~/.self-generation/hooks/pre-tool-guide.mjs
// PreToolUse hook — provides proactive guidance based on error KB history

import { getDb, readStdin, isEnabled } from '../lib/db.mjs';

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);
  const parts = [];

  // 1. Edit/Write: file-related error history from error_kb
  if (['Edit', 'Write'].includes(input.tool_name) && input.tool_input?.file_path) {
    const filePath = input.tool_input.file_path;
    const fileName = filePath.split('/').pop();
    const db = getDb();

    const kbResults = db.prepare(`
      SELECT error_normalized, resolution FROM error_kb
      WHERE error_normalized LIKE ? AND resolution IS NOT NULL
      ORDER BY last_used DESC LIMIT 2
    `).all(`%${fileName}%`);

    for (const kb of kbResults) {
      parts.push(`⚠️ 이 파일 관련 과거 에러: ${kb.error_normalized}`);
      try {
        const res = JSON.parse(kb.resolution);
        parts.push(`   해결 방법: ${res.resolvedBy || ''} (${res.tool || ''})`);
        if (res.toolSequence) parts.push(`   해결 경로: ${res.toolSequence.join(' → ')}`);
      } catch { parts.push(`   해결 방법: ${kb.resolution}`); }
    }
  }

  // 2. Bash: previous failed command warning
  if (input.tool_name === 'Bash' && input.tool_input?.command) {
    const db = getDb();
    const recentBashErrors = db.prepare(`
      SELECT json_extract(data, '$.error') AS error FROM events
      WHERE type = 'tool_error' AND session_id = ? AND json_extract(data, '$.tool') = 'Bash'
      ORDER BY ts DESC LIMIT 1
    `).get(input.session_id);

    if (recentBashErrors?.error) {
      const kbResult = db.prepare(`
        SELECT error_normalized, resolution FROM error_kb
        WHERE error_normalized = ? AND resolution IS NOT NULL
        LIMIT 1
      `).get(recentBashErrors.error);

      if (kbResult) {
        parts.push(`💡 이 세션에서 Bash 에러 발생 이력: ${kbResult.error_normalized}`);
        try {
          const resolution = JSON.parse(kbResult.resolution);
          if (resolution?.toolSequence) {
            parts.push(`   이전 해결 경로: ${resolution.toolSequence.join(' → ')}`);
          }
        } catch {}
      }
    }
  }

  // 3. Task: subagent failure rate (v9: disabled, no success field)
  // v9: Disabled — SubagentStop API does not provide error/success information.
  // The success field was removed from subagent_stop events (see subagent-tracker.mjs).
  // To re-enable, implement agent_transcript_path parsing for failure detection,
  // then query the resulting field here.
  // if (input.tool_name === 'Task' && input.tool_input?.subagent_type) { ... }

  if (parts.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: parts.join('\n') }
    }));
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
