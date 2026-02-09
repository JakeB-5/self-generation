// ~/.self-generation/lib/ai-analyzer.mjs
// AI-based pattern analysis using claude --print

import { execSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb, queryEvents, GLOBAL_DIR } from './db.mjs';

const PROMPT_TEMPLATE = join(GLOBAL_DIR, 'prompts', 'analyze.md');

/**
 * Content-addressable hash of input events (v9: QMD SHA-256 pattern)
 * Same input events produce the same hash → skip redundant AI analysis
 */
function computeInputHash(events) {
  const content = events
    .map(e => `${e.type}:${e.ts}:${e.session_id}:${JSON.stringify(e.data)}`)
    .join('\n');
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Run AI analysis on collected events
 * @param {Object} options - { days: 7, project: null, projectPath: null }
 * @returns {Object} - Analysis result with suggestions array
 */
export async function runAnalysis(options = {}) {
  const { days = 7, project = null, projectPath = null } = options;

  try {
    const db = getDb();

    // Query events with date filter
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const entries = queryEvents({
      since,
      project,
      projectPath
    });

    // Insufficient data check
    const promptCount = entries.filter(e => e.type === 'prompt').length;
    if (promptCount < 5) {
      return { suggestions: [], reason: 'insufficient_data' };
    }

    // Content-addressable cache check
    const inputHash = computeInputHash(entries);
    const projectKey = project || 'all';
    const cached = db.prepare(`
      SELECT analysis FROM analysis_cache
      WHERE project = ? AND days = ? AND input_hash = ?
    `).get(projectKey, days, inputHash);

    if (cached) {
      return JSON.parse(cached.analysis);
    }

    // Build prompt with summarized log data
    const logSummary = summarizeForPrompt(entries);
    const prompt = await buildPrompt(logSummary, days, project, projectPath);

    // Execute claude --print with timeout and large buffer
    const result = execSync('claude --print --model sonnet', {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000
    });

    const analysis = JSON.parse(extractJSON(result));

    // Save to analysis_cache with UPSERT
    db.prepare(`
      INSERT INTO analysis_cache (ts, project, days, input_hash, analysis)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project, days, input_hash)
      DO UPDATE SET ts = excluded.ts, analysis = excluded.analysis
    `).run(new Date().toISOString(), projectKey, days, inputHash, JSON.stringify(analysis));

    return analysis;
  } catch (e) {
    // AI analysis failure - return empty result for system stability
    return { suggestions: [], error: e.message };
  }
}

/**
 * Run AI analysis in background (detached process)
 * Called from SessionEnd hook
 */
export function runAnalysisAsync(options = {}) {
  const { days = 7, project = null, projectPath = null } = options;

  const child = spawn('node', [
    join(GLOBAL_DIR, 'bin', 'analyze.mjs'),
    '--days', String(days),
    ...(project ? ['--project', project] : []),
    ...(projectPath ? ['--project-path', projectPath] : [])
  ], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
}

/**
 * Get cached analysis result from DB
 * Called from SessionStart hook
 * @param {number} maxAgeHours - Maximum age of cached result (default: 24)
 * @param {string|null} project - Project filter (default: null → 'all')
 * @returns {Object|null} - Parsed analysis or null
 */
export function getCachedAnalysis(maxAgeHours = 24, project = null) {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - maxAgeHours * 3600000).toISOString();
    const projectKey = project || 'all';

    const row = db.prepare(`
      SELECT analysis FROM analysis_cache
      WHERE ts >= ? AND project = ?
      ORDER BY ts DESC LIMIT 1
    `).get(cutoff, projectKey);

    if (!row) return null;
    return JSON.parse(row.analysis);
  } catch {
    return null;
  }
}

/**
 * Summarize log entries for prompt injection
 * Extract core information without bloating token usage
 */
function summarizeForPrompt(entries, maxPrompts = 100) {
  const prompts = entries
    .filter(e => e.type === 'prompt')
    .slice(-maxPrompts)
    .map(e => ({ ts: e.ts, text: e.text, project: e.project }));

  const tools = entries.filter(e => e.type === 'tool_use');
  const errors = entries.filter(e => e.type === 'tool_error');
  const summaries = entries.filter(e => e.type === 'session_summary');

  // Session-wise tool sequences
  const sessionTools = {};
  for (const t of tools) {
    if (!sessionTools[t.sessionId]) sessionTools[t.sessionId] = [];
    sessionTools[t.sessionId].push(t.tool);
  }

  return {
    prompts,
    toolSequences: Object.values(sessionTools).map(seq => seq.join(' → ')),
    errors: errors.map(e => ({
      tool: e.tool,
      error: e.error,
      raw: e.errorRaw
    })),
    sessionCount: summaries.length,
    toolTotal: tools.length
  };
}

/**
 * Build AI analysis prompt from template
 * Inject log data, feedback history, existing skills, outcome metrics
 */
async function buildPrompt(logSummary, days, project, projectPath = null) {
  let template = readFileSync(PROMPT_TEMPLATE, 'utf-8');
  template = template.replace('{{days}}', String(days));
  template = template.replace('{{project}}', project || 'all');
  template = template.replace('{{log_data}}', JSON.stringify(logSummary, null, 2));

  // Feedback history injection (graceful fallback if module not ready)
  let feedback = null;
  try {
    const feedbackModule = await import('./feedback-tracker.mjs');
    feedback = feedbackModule.getFeedbackSummary();
  } catch {
    // feedback-tracker not ready, use fallback
  }
  template = template.replace('{{feedback_history}}',
    feedback ? JSON.stringify(feedback, null, 2) : '피드백 이력 없음 (첫 분석)');

  // Existing skills injection (graceful fallback if module not ready)
  let skills = [];
  try {
    const skillModule = await import('./skill-matcher.mjs');
    const resolvedPath = projectPath || (project
      ? queryEvents({ project, limit: 1 })[0]?.projectPath || null
      : null);
    skills = skillModule.loadSkills(resolvedPath);
  } catch {
    // skill-matcher not ready, use fallback
  }
  template = template.replace('{{existing_skills}}',
    skills.length > 0
      ? skills.map(s => `- ${s.name}: ${s.description || ''}`).join('\n')
      : '등록된 스킬 없음');

  // Outcome metrics injection
  const outcomes = {
    skillUsageRate: feedback?.skillUsageRate,
    ruleEffectiveness: feedback?.ruleEffectiveness,
    staleSkills: feedback?.staleSkills
  };
  template = template.replace('{{outcome_metrics}}',
    JSON.stringify(outcomes, null, 2));

  return template;
}

/**
 * Extract JSON from Claude response
 * Handles ```json blocks or raw JSON
 */
function extractJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) return match[1];

  // Fallback to raw JSON search
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}
