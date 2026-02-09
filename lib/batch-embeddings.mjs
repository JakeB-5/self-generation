// ~/.self-generation/lib/batch-embeddings.mjs
// Detached batch embedding processor for error KB and skills

import { getDb, generateEmbeddings } from './db.mjs';
import { loadSkills, extractPatterns } from './skill-matcher.mjs';
import { isServerRunning, startServer } from './embedding-client.mjs';

const projectPath = process.argv[2] || process.cwd();

try {
  // REQ-RA-601: 10s startup delay to reduce DB write contention
  // This does NOT guarantee contention-free access — concurrent writes are ultimately
  // handled by SQLite WAL mode + busy_timeout(10s) below. The delay merely reduces
  // the frequency of busy retries in the common case.
  await new Promise(r => setTimeout(r, 10000));

  const db = getDb();

  // REQ-RA-602: Extended busy_timeout for concurrent writes
  db.pragma('busy_timeout = 10000');

  // REQ-RA-603: Embedding daemon wait loop
  let running = await isServerRunning();
  if (!running) {
    await startServer();
    // Wait up to 15 seconds for daemon to start
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      running = await isServerRunning();
      if (running) break;
    }
  }

  // REQ-RA-604: Error KB batch embeddings
  const missing = db.prepare(`
    SELECT id, error_normalized FROM error_kb
    WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)
  `).all();

  if (missing.length > 0) {
    const texts = missing.map(r => r.error_normalized);
    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < missing.length; i++) {
      // Skip null/undefined embeddings
      if (!embeddings[i]) continue;

      const blob = Buffer.from(new Float32Array(embeddings[i]).buffer);
      const eid = Number(missing[i].id);
      db.prepare('DELETE FROM vec_error_kb WHERE error_kb_id = ?').run(eid);
      db.prepare('INSERT INTO vec_error_kb (error_kb_id, embedding) VALUES (?, ?)').run(eid, blob);
    }
  }

  // REQ-RA-605: Skill embeddings refresh
  const skills = loadSkills(projectPath);

  for (const skill of skills) {
    try {
      const keywords = extractPatterns(skill.content);

      // UPSERT skill metadata
      const result = db.prepare(`
        INSERT OR REPLACE INTO skill_embeddings (name, source_path, description, keywords, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        skill.name,
        skill.sourcePath,
        skill.description || null,
        JSON.stringify(keywords),
        new Date().toISOString()
      );

      // Get skillId from UPSERT result or fallback query (Number() for sqlite-vec compatibility)
      let skillId = Number(result.lastInsertRowid);
      if (!skillId) {
        const row = db.prepare('SELECT id FROM skill_embeddings WHERE name = ?').get(skill.name);
        skillId = Number(row?.id);
      }
      if (!skillId) continue;

      // Generate embedding from first 500 chars
      const text = skill.content.slice(0, 500);
      const embeddings = await generateEmbeddings([text]);

      // Skip if embedding generation failed
      if (!embeddings || !embeddings[0]) continue;

      const blob = Buffer.from(new Float32Array(embeddings[0]).buffer);
      db.prepare('DELETE FROM vec_skill_embeddings WHERE skill_id = ?').run(Number(skillId));
      db.prepare('INSERT INTO vec_skill_embeddings (skill_id, embedding) VALUES (?, ?)').run(Number(skillId), blob);
    } catch {
      // Skip failed skill, continue to next
      continue;
    }
  }

  // REQ-RA-606: Non-blocking exit (success)
  process.exit(0);
} catch (e) {
  // REQ-RA-606: Non-blocking exit (error)
  // Batch embedding is non-critical, always exit 0
  process.exit(0);
}
