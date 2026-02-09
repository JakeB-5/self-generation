// hooks/subagent-tracker.mjs
// SubagentStop hook — records subagent execution events to events table

import { insertEvent, readStdin, isEnabled, getProjectName, getProjectPath } from '../lib/db.mjs';

try {
  const input = await readStdin();
  if (!isEnabled()) process.exit(0);

  insertEvent({
    v: 1,
    type: 'subagent_stop',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(getProjectPath(input.cwd)),
    projectPath: getProjectPath(input.cwd),
    agentId: input.agent_id,
    agentType: input.agent_type
    // v9: success field removed — SubagentStop API doesn't provide error/success info
  });

  process.exit(0);
} catch (e) {
  process.exit(0);
}
