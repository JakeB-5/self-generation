// ~/.self-generation/hooks/session-summary.mjs
import { insertEvent, queryEvents, getProjectName, getProjectPath, getDb, readStdin, generateEmbeddings, isEnabled, pruneOldEvents } from '../lib/db.mjs';
import { runAnalysisAsync } from '../lib/ai-analyzer.mjs';
import { join } from 'path';

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);

  const skipAnalysis = input.reason === 'clear' || false;
  const sessionEntries = queryEvents({ sessionId: input.session_id });

  const prompts = sessionEntries.filter(e => e.type === 'prompt');
  const tools = sessionEntries.filter(e => e.type === 'tool_use');
  const errors = sessionEntries.filter(e => e.type === 'tool_error');

  const toolCounts = {};
  for (const t of tools) {
    toolCounts[t.tool] = (toolCounts[t.tool] || 0) + 1;
  }

  // Sort tools chronologically for toolSequence (queryEvents returns DESC)
  const toolsSorted = [...tools].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const toolSequence = toolsSorted.map(t => t.tool);

  const entry = {
    v: 1,
    type: 'session_summary',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(getProjectPath(input.cwd)),
    projectPath: getProjectPath(input.cwd),
    promptCount: prompts.length,
    toolCounts,
    toolSequence,
    errorCount: errors.length,
    uniqueErrors: [...new Set(errors.map(e => e.error))],
    // queryEvents returns DESC order, so slice(0,3) gets most recent 3
    lastPrompts: prompts.slice(0, 3).map(p => (p.text || '').slice(0, 100)),
    // lastEditedFiles: DESC order (most recent first), up to 5 files
    lastEditedFiles: [...new Set(
      tools
        .filter(t => t.tool === 'Edit' || t.tool === 'Write')
        .map(t => t.meta?.file)
        .filter(Boolean)
    )].slice(0, 5),
    reason: input.reason || 'unknown'
  };

  insertEvent(entry);

  // AI analysis trigger (background, non-blocking)
  if (!skipAnalysis && prompts.length >= 3) {
    runAnalysisAsync({ days: 7, project: getProjectName(getProjectPath(input.cwd)), projectPath: getProjectPath(input.cwd) });
  }

  // Probabilistic DB pruning (10% chance)
  if (Math.random() < 0.1) {
    try { pruneOldEvents(); } catch {}
  }

  // Batch embedding trigger (detached process)
  try {
    const { spawn } = await import('child_process');
    const batchScript = join(process.env.HOME, '.self-generation', 'lib', 'batch-embeddings.mjs');
    const child = spawn('node', [batchScript, getProjectPath(input.cwd)], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } catch {}

  process.exit(0);
} catch (e) {
  process.exit(0);
}
