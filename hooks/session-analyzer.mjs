// ~/.self-generation/hooks/session-analyzer.mjs (v6 extended)
import { queryEvents, getProjectName, getProjectPath, readStdin, isEnabled } from '../lib/db.mjs';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);
  const projectDir = getProjectPath(input.cwd);
  const project = getProjectName(projectDir);

  const isResume = input.source === 'resume';
  const contextParts = [];

  // 1. Cached AI analysis injection
  const analysis = getCachedAnalysis(24, project);
  if (analysis && analysis.suggestions?.length > 0) {
    let msg = '[Self-Generation] AI 패턴 분석 결과:\n';
    for (const s of analysis.suggestions.slice(0, 3)) {
      msg += `- [${s.type}] ${s.summary} [id: ${s.id}]\n`;
    }
    msg += '\n사용자에게 이 개선 제안을 알려주세요.';
    msg += '\n사용자가 승인하면 `node ~/.self-generation/bin/apply.mjs <번호>` 로 적용하세요.';
    msg += '\n사용자가 거부하면 `node ~/.self-generation/bin/dismiss.mjs <id>` 로 기록하세요.';
    contextParts.push(msg);
  }

  // 2. Previous session context injection
  const recentSummaries = queryEvents({ type: 'session_summary', projectPath: projectDir, limit: 1 });

  if (recentSummaries.length > 0) {
    const prev = recentSummaries[0];
    const parts = [`[Self-Generation] 이전 세션 컨텍스트 (${prev.ts}):`];
    parts.push(`- 프롬프트 ${prev.promptCount}개, 도구 ${Object.values(prev.toolCounts || {}).reduce((a, b) => a + b, 0)}회 사용`);

    if (prev.lastPrompts?.length > 0) {
      parts.push(`- 이전 세션 마지막 작업: ${prev.lastPrompts.map(p => `"${p}"`).join(', ')}`);
    }
    if (prev.lastEditedFiles?.length > 0) {
      parts.push(`- 수정 중이던 파일: ${prev.lastEditedFiles.join(', ')}`);
    }

    if (prev.errorCount > 0) {
      parts.push(`- 미해결 에러 ${prev.errorCount}건: ${(prev.uniqueErrors || []).slice(0, 2).join(', ')}`);
    }

    if (isResume && prev.uniqueErrors?.length > 0) {
      parts.push(`- [RESUME] 미해결 에러 상세: ${prev.uniqueErrors.join(', ')}`);
    }

    const topTools = Object.entries(prev.toolCounts || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([t, c]) => `${t}(${c})`).join(', ');
    parts.push(`- 주요 도구: ${topTools}`);
    contextParts.push(parts.join('\n'));
  }

  // Auto-start embedding daemon
  try {
    const { isServerRunning, startServer } = await import('../lib/embedding-client.mjs');
    if (!await isServerRunning()) {
      await startServer();
    }
  } catch {}

  if (contextParts.length > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: contextParts.join('\n\n')
      }
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}
