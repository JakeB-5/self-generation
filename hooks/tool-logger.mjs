// hooks/tool-logger.mjs
// PostToolUse hook — records tool usage and detects error resolutions

import { insertEvent, queryEvents, getProjectName, getProjectPath, readStdin, isEnabled } from '../lib/db.mjs';
import { recordResolution } from '../lib/error-kb.mjs';

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);

  const entry = {
    v: 1,
    type: 'tool_use',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(getProjectPath(input.cwd)),
    projectPath: getProjectPath(input.cwd),
    tool: input.tool_name,
    meta: extractToolMeta(input.tool_name, input.tool_input),
    success: true
  };

  insertEvent(entry);

  // Resolution detection
  try {
    const sessionEntries = queryEvents({ sessionId: input.session_id, limit: 50 })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    // 1. Same-tool resolution
    const sameToolErrors = sessionEntries
      .filter(e => e.type === 'tool_error' && e.tool === input.tool_name);

    if (sameToolErrors.length > 0) {
      const lastError = sameToolErrors[sameToolErrors.length - 1];
      const errorIdx = sessionEntries.indexOf(lastError);
      const toolsBetween = sessionEntries
        .slice(errorIdx + 1)
        .filter(e => e.type === 'tool_use')
        .slice(0, 5)
        .map(e => e.tool);

      recordResolution(lastError.error, {
        tool: input.tool_name,
        sessionId: input.session_id,
        resolvedBy: 'success_after_error',
        errorRaw: lastError.errorRaw || null,
        filePath: entry.meta?.file || null,
        toolSequence: toolsBetween,
        promptContext: sessionEntries
          .filter(e => e.type === 'prompt')
          .slice(-1)[0]?.text?.slice(0, 200) || null
      });
    }

    // 2. Cross-tool resolution
    // Check errors from OTHER tools (not current tool)
    const pendingErrors = sessionEntries
      .filter(e => e.type === 'tool_error' && e.tool !== input.tool_name);

    for (const pendingError of pendingErrors) {
      const errorIdx = sessionEntries.indexOf(pendingError);

      // Check if this error was already resolved by its original tool
      const laterSuccesses = sessionEntries
        .slice(errorIdx + 1)
        .filter(e => e.type === 'tool_use' && e.tool === pendingError.tool && e.success);

      if (laterSuccesses.length > 0) {
        // Error was resolved - check if current tool helped
        const helpingTools = sessionEntries
          .slice(errorIdx + 1, sessionEntries.indexOf(laterSuccesses[0]))
          .filter(e => e.type === 'tool_use')
          .map(e => e.tool);

        if (helpingTools.includes(input.tool_name)) {
          recordResolution(pendingError.error, {
            tool: pendingError.tool,
            sessionId: input.session_id,
            resolvedBy: 'cross_tool_resolution',
            errorRaw: pendingError.errorRaw || null,
            helpingTool: input.tool_name,
            filePath: entry.meta?.file || null,
            toolSequence: helpingTools
          });
        }
      }
    }
  } catch (resolutionError) {
    // Silent fail
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}

function extractToolMeta(tool, toolInput) {
  if (!toolInput) return {};

  switch (tool) {
    case 'Bash':
      const cmd = (toolInput.command || '').split(/\s+/)[0];
      return { command: cmd };

    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = toolInput.file_path;
      if (!filePath) return {};

      // Check for sensitive file patterns
      const sensitivePatterns = [
        /\/.env$/,
        /\/.env\./,
        /\/\.env$/,
        /\/credentials\.json$/,
        /\.key$/,
        /\.pem$/,
        /\/id_rsa/
      ];

      const isSensitive = sensitivePatterns.some(pattern => pattern.test(filePath));
      return { file: isSensitive ? '[SENSITIVE_PATH]' : filePath };
    }

    case 'Grep':
    case 'Glob':
      return { pattern: toolInput.pattern };

    case 'Task':
      return {
        agentType: toolInput.subagent_type,
        model: toolInput.model
      };

    default:
      return {};
  }
}
