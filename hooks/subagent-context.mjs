// hooks/subagent-context.mjs
// SubagentStart hook — injects project error patterns and AI analysis rules to code-working agents

import { queryEvents, getDb, getProjectName, getProjectPath, readStdin, isEnabled } from '../lib/db.mjs';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';

const CODE_AGENTS = ['executor', 'executor-low', 'executor-high', 'architect', 'architect-medium',
  'designer', 'designer-high', 'build-fixer', 'build-fixer-low'];

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);
  const agentType = input.agent_type || '';

  // Only inject context for code-working agents
  if (!CODE_AGENTS.some(a => agentType.includes(a))) {
    process.exit(0);
  }

  const parts = [];
  const projectDir = getProjectPath(input.cwd);
  const project = getProjectName(projectDir);

  // 1. Recent project error patterns (SQL indexed query)
  const projectErrors = queryEvents({ type: 'tool_error', projectPath: projectDir, limit: 3 });

  if (projectErrors.length > 0) {
    parts.push('이 프로젝트의 최근 에러 패턴:');
    const db = getDb();
    for (const err of projectErrors) {
      parts.push(`- ${err.error} (${err.tool})`);
      const kb = db.prepare(`
        SELECT resolution FROM error_kb
        WHERE error_normalized = ? AND resolution IS NOT NULL
        ORDER BY use_count DESC LIMIT 1
      `).get(err.error);
      if (kb?.resolution) {
        parts.push(`  해결: ${JSON.stringify(kb.resolution).slice(0, 150)}`);
      }
    }
  }

  // 2. Cached AI analysis rules (project-scoped)
  const analysis = getCachedAnalysis(48, project);
  if (analysis?.suggestions) {
    const rules = analysis.suggestions
      .filter(s => s.type === 'claude_md' && (!s.project || s.project === project))
      .slice(0, 3);
    if (rules.length > 0) {
      parts.push('적용할 프로젝트 규칙:');
      rules.forEach(r => parts.push(`- ${r.rule || r.summary}`));
    }
  }

  if (parts.length > 0) {
    const context = parts.join('\n').slice(0, 500);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: context }
    }));
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
