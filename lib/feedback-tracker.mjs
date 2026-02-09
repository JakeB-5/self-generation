// ~/.self-generation/lib/feedback-tracker.mjs
// Feedback tracking — record suggestion outcomes, calculate acceptance rates

import { getDb } from './db.mjs';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Record feedback for a suggestion (accepted/rejected/dismissed)
 * @param {string} suggestionId - Unique suggestion identifier
 * @param {string} action - 'accepted', 'rejected', or 'dismissed'
 * @param {Object} details - Optional metadata (suggestionType, summary)
 */
export function recordFeedback(suggestionId, action, details = {}) {
  try {
    const db = getDb();
    const ts = new Date().toISOString();
    const suggestionType = details.suggestionType || null;
    const summary = details.summary || null;

    db.prepare(`
      INSERT INTO feedback (v, ts, suggestion_id, action, suggestion_type, summary)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(ts, suggestionId, action, suggestionType, summary);
  } catch {
    // Silently catch all errors
  }
}

/**
 * Get aggregated feedback summary with rates and recent actions
 * @returns {Promise<Object|null>} Summary object or null if no data/error
 */
export async function getFeedbackSummary() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM feedback ORDER BY ts ASC').all();

    if (rows.length === 0) return null;

    const acceptedCount = rows.filter(r => r.action === 'accepted').length;
    const rejectedCount = rows.filter(r => r.action === 'rejected' || r.action === 'dismissed').length;
    const total = rows.length;
    const rate = total > 0 ? acceptedCount / total : 0;

    // Last 10 rejected/dismissed
    const rejected = rows.filter(r => r.action === 'rejected' || r.action === 'dismissed');
    const recentRejections = rejected.slice(-10).map(e => e.summary || e.suggestion_id);

    // Last 10 accepted
    const accepted = rows.filter(r => r.action === 'accepted');
    const recentAcceptances = accepted.slice(-10).map(e => e.summary || e.suggestion_id);

    const skillUsageRate = calcSkillUsageRate();
    const ruleEffectiveness = calcRuleEffectiveness();
    const staleSkills = await findStaleSkills(30);

    return {
      total,
      acceptedCount,
      rejectedCount,
      rate,
      recentRejections,
      recentAcceptances,
      skillUsageRate,
      ruleEffectiveness,
      staleSkills
    };
  } catch {
    return null;
  }
}

/**
 * Calculate skill usage rate (skill_used / skill_created)
 * @returns {number|null} Usage rate or null
 */
function calcSkillUsageRate() {
  try {
    const db = getDb();
    const usedResult = db.prepare(`
      SELECT COUNT(*) AS cnt FROM events WHERE type = 'skill_used'
    `).get();
    const createdResult = db.prepare(`
      SELECT COUNT(*) AS cnt FROM events WHERE type = 'skill_created'
    `).get();

    const used = usedResult?.cnt || 0;
    const created = createdResult?.cnt || 0;

    if (created === 0) return null;
    return used / created;
  } catch {
    return null;
  }
}

/**
 * Calculate rule effectiveness via error counts
 * @returns {Object|null} { totalErrors, recentErrors } or null
 */
function calcRuleEffectiveness() {
  try {
    const db = getDb();
    const recentCutoff = new Date(Date.now() - 7 * 86400000).toISOString();

    const totalResult = db.prepare(`
      SELECT COUNT(*) AS cnt FROM events WHERE type = 'tool_error'
    `).get();

    const recentResult = db.prepare(`
      SELECT COUNT(*) AS cnt FROM events WHERE type = 'tool_error' AND ts >= ?
    `).get(recentCutoff);

    return {
      totalErrors: totalResult?.cnt || 0,
      recentErrors: recentResult?.cnt || 0
    };
  } catch {
    return null;
  }
}

/**
 * Find stale skills (not used within threshold days)
 * @param {number} days - Threshold for staleness (default: 30)
 * @param {string|null} projectPath - Optional project filter
 * @returns {Promise<Array<Object>>} List of stale skills or []
 */
async function findStaleSkills(days = 30, projectPath = null) {
  try {
    const db = getDb();
    const threshold = new Date(Date.now() - days * 86400000).toISOString();

    // Try to import loadSkills from skill-matcher.mjs
    let loadSkills;
    const skillMatcherPath = join(process.env.HOME, '.self-generation', 'lib', 'skill-matcher.mjs');

    if (!existsSync(skillMatcherPath)) {
      return []; // skill-matcher.mjs doesn't exist yet
    }

    // Dynamic import with try-catch for module loading
    try {
      const module = await import('./skill-matcher.mjs');
      loadSkills = module.loadSkills;
    } catch {
      return []; // Module exists but can't be loaded
    }

    const skills = loadSkills();
    const stale = [];

    for (const skill of skills) {
      const lastUsageRow = db.prepare(`
        SELECT ts FROM events
        WHERE type = 'skill_used'
          AND json_extract(data, '$.skillName') = ?
        ORDER BY ts DESC LIMIT 1
      `).get(skill.name);

      const lastUsage = lastUsageRow?.ts;

      if (!lastUsage || lastUsage < threshold) {
        stale.push({
          name: skill.name,
          lastUsed: lastUsage || null,
          daysSinceUsed: lastUsage
            ? Math.floor((Date.now() - new Date(lastUsage).getTime()) / 86400000)
            : null
        });
      }
    }

    return stale;
  } catch {
    return [];
  }
}
