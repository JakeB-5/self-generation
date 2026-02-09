#!/usr/bin/env node
// ~/.self-generation/hooks/prompt-logger.mjs
// Hook: UserPromptSubmit — Record prompts + skill auto-detection

import { insertEvent, getProjectName, getProjectPath, readStdin, loadConfig, stripPrivateTags } from '../lib/db.mjs';
import { loadSkills, matchSkill } from '../lib/skill-matcher.mjs';

try {
  const input = await readStdin();
  const config = loadConfig();
  if (config.enabled === false) process.exit(0);

  // Privacy tag stripping (REQ-DC-103) + collectPromptText check (REQ-DC-102)
  const rawPrompt = config.collectPromptText === false ? '[REDACTED]' : input.prompt;
  const promptText = stripPrivateTags(rawPrompt);

  // 1. Record prompt (REQ-DC-101)
  const entry = {
    v: 1,
    type: 'prompt',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(getProjectPath(input.cwd)),
    projectPath: getProjectPath(input.cwd),
    text: promptText,
    charCount: promptText.length
  };
  insertEvent(entry);

  // 2. Skill auto-detection (REQ-DC-104)
  const projectPath = getProjectPath(input.cwd);
  const skills = loadSkills(projectPath);
  if (skills.length > 0) {
    const matched = await Promise.race([
      matchSkill(input.prompt, skills),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    if (matched) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `[Self-Generation] 이 작업과 관련된 커스텀 스킬이 있습니다: ` +
            `\`/${matched.name}\` (${matched.scope === 'global' ? '전역' : '프로젝트'} 스킬)\n` +
            `사용자에게 이 스킬 사용을 제안해주세요.`
        }
      };
      process.stdout.write(JSON.stringify(output));
    }
  }

  // 3. Skill usage event tracking (REQ-DC-105)
  if (input.prompt && input.prompt.startsWith('/')) {
    const skillName = input.prompt.split(/\s+/)[0].slice(1);
    const isActualSkill = skills.some(s => s.name === skillName);
    if (isActualSkill) {
      insertEvent({
        v: 1,
        type: 'skill_used',
        ts: new Date().toISOString(),
        sessionId: input.session_id,
        project: getProjectName(getProjectPath(input.cwd)),
        projectPath: getProjectPath(input.cwd),
        skillName
      });
    }
  }

  process.exit(0);
} catch (e) {
  // REQ-DC-106: Non-blocking (exit 0 on any error)
  process.exit(0);
}
