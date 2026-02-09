// ~/.self-generation/lib/skill-matcher.mjs
// Skill-prompt matching with vector similarity + keyword fallback

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { getDb, vectorSearch, generateEmbeddings } from './db.mjs';

/**
 * Load existing skills from global and project directories
 * @param {string|null} projectPath - Project root path (optional)
 * @returns {Array<{name: string, scope: string, content: string, description: string|null, sourcePath: string}>}
 */
export function loadSkills(projectPath) {
  const skills = [];

  // Global skills
  const globalDir = join(process.env.HOME, '.claude', 'commands');
  if (existsSync(globalDir)) {
    for (const file of readdirSync(globalDir)) {
      if (file.endsWith('.md')) {
        const sourcePath = join(globalDir, file);
        const content = readFileSync(sourcePath, 'utf-8');
        const firstParagraph = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
        skills.push({
          name: file.replace('.md', ''),
          scope: 'global',
          content,
          description: firstParagraph?.trim() || null,
          sourcePath
        });
      }
    }
  }

  // Project skills
  if (projectPath) {
    const projectDir = join(projectPath, '.claude', 'commands');
    if (existsSync(projectDir)) {
      for (const file of readdirSync(projectDir)) {
        if (file.endsWith('.md')) {
          const sourcePath = join(projectDir, file);
          const content = readFileSync(sourcePath, 'utf-8');
          const firstParagraph = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
          skills.push({
            name: file.replace('.md', ''),
            scope: 'project',
            content,
            description: firstParagraph?.trim() || null,
            sourcePath
          });
        }
      }
    }
  }

  return skills;
}

/**
 * Match prompt against skills using vector similarity + keyword fallback
 * @param {string} prompt - User prompt text
 * @param {Array} skills - Skills loaded by loadSkills()
 * @returns {Promise<{name: string, match: 'vector'|'keyword', confidence: number, scope: string}|null>}
 */
export async function matchSkill(prompt, skills) {
  // Step 1: Vector similarity search (primary)
  try {
    const embeddings = await generateEmbeddings([prompt]);
    if (embeddings && embeddings.length > 0 && embeddings[0]) {
      const results = vectorSearch('skill_embeddings', 'vec_skill_embeddings', embeddings[0], 1);
      if (results.length > 0 && results[0].distance < 0.76) {
        return {
          name: results[0].name,
          match: 'vector',
          confidence: 1 - results[0].distance,
          scope: skills.find(s => s.name === results[0].name)?.scope || 'global'
        };
      }
    }
  } catch {
    // Vector search not available (daemon not running), fall through to keyword matching
  }

  // Step 2: Keyword pattern matching (fallback)
  return keywordMatch(prompt, skills);
}

/**
 * Keyword-based skill matching (fallback)
 * Matches if 50%+ of pattern keywords appear in prompt
 */
function keywordMatch(prompt, skills) {
  const promptLower = prompt.toLowerCase();

  for (const skill of skills) {
    const patterns = extractPatterns(skill.content);
    for (const pattern of patterns) {
      // Match if 50%+ of pattern words (3+ chars) appear in prompt
      const patternWords = pattern.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      const matchCount = patternWords.filter(w => promptLower.includes(w)).length;
      if (patternWords.length > 0 && matchCount / patternWords.length >= 0.5) {
        return {
          name: skill.name,
          match: 'keyword',
          confidence: matchCount / patternWords.length,
          scope: skill.scope
        };
      }
    }
  }

  return null;
}

/**
 * Extract patterns from skill file content
 * Finds "감지된 패턴" section and extracts "- " prefixed items
 * @param {string} content - Skill file content
 * @returns {string[]} - Array of pattern strings (quotes and prefix stripped)
 */
export function extractPatterns(content) {
  const patterns = [];
  const lines = content.split('\n');
  let inSection = false;

  for (const line of lines) {
    if (line.includes('감지된 패턴')) {
      inSection = true;
      continue;
    }
    if (line.startsWith('#')) {
      inSection = false;
      continue;
    }
    if (inSection && line.startsWith('- ')) {
      // Strip "- " prefix and surrounding quotes
      patterns.push(line.replace(/^- "?|"?$/g, '').trim());
    }
  }

  return patterns;
}

/**
 * Refresh embeddings for skills that need update
 * Called by batch-embeddings during SessionEnd/SessionStart
 */
export async function refreshSkillEmbeddings() {
  const db = getDb();

  // Load all current skills from filesystem
  const skills = loadSkills(process.env.CLAUDE_PROJECT_DIR || process.cwd());

  for (const skill of skills) {
    try {
      // Check if skill exists in DB and needs update
      const existing = db.prepare('SELECT id, updated_at FROM skill_embeddings WHERE name = ?').get(skill.name);
      const fileMtime = statSync(skill.sourcePath).mtime.toISOString();

      let skillId;
      if (!existing) {
        // Insert new skill
        const keywords = extractPatterns(skill.content);
        const result = db.prepare(`
          INSERT INTO skill_embeddings (name, source_path, description, keywords, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(skill.name, skill.sourcePath, skill.description || null, JSON.stringify(keywords), fileMtime);
        skillId = result.lastInsertRowid;
      } else if (existing.updated_at < fileMtime) {
        // Update existing skill metadata
        const keywords = extractPatterns(skill.content);
        db.prepare(`
          UPDATE skill_embeddings
          SET source_path = ?, description = ?, keywords = ?, updated_at = ?
          WHERE name = ?
        `).run(skill.sourcePath, skill.description || null, JSON.stringify(keywords), fileMtime, skill.name);
        skillId = existing.id;
      } else {
        // Check if embedding exists
        const hasEmbedding = db.prepare(`
          SELECT 1 FROM vec_skill_embeddings WHERE skill_id = ?
        `).get(existing.id);
        if (hasEmbedding) continue; // Already up-to-date
        skillId = existing.id;
      }

      // Generate embedding
      const keywords = JSON.parse(db.prepare('SELECT keywords FROM skill_embeddings WHERE id = ?').get(skillId).keywords || '[]');
      const text = [skill.description || '', ...keywords].filter(Boolean).join(' ');
      if (!text) continue;

      const embeddings = await generateEmbeddings([text]);
      if (!embeddings || embeddings.length === 0 || !embeddings[0]) continue;

      // Store embedding in vec0 virtual table
      const embeddingBlob = Buffer.from(new Float32Array(embeddings[0]).buffer);
      db.prepare(`
        INSERT OR REPLACE INTO vec_skill_embeddings (skill_id, embedding)
        VALUES (?, ?)
      `).run(skillId, embeddingBlob);

    } catch (err) {
      // Skip failed skills, continue processing
      continue;
    }
  }
}
