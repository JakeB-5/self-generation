// ~/.self-generation/lib/error-kb.mjs
// Error Knowledge Base module — normalize, search, record resolutions

import { getDb, generateEmbeddings, vectorSearch } from './db.mjs';

/**
 * Normalize error text for deduplication
 * REQ-RTA-401: Path → <PATH>, numbers → <N>, quoted strings → <STR>
 */
export function normalizeError(error) {
  if (!error) return '';

  let normalized = String(error);

  // Step 1: Replace quoted strings (≤100 chars) → <STR> FIRST
  // (must happen before path replacement to handle quoted paths)
  normalized = normalized.replace(/"([^"]{1,100})"/g, '<STR>');
  normalized = normalized.replace(/'([^']{1,100})'/g, '<STR>');

  // Step 2: Replace file paths (/... or ./) → <PATH>
  normalized = normalized.replace(/\/[^\s]+/g, '<PATH>');
  normalized = normalized.replace(/\.[/\\][^\s]+/g, '<PATH>');

  // Step 3: Replace 2+ digit numbers → <N>
  normalized = normalized.replace(/\d{2,}/g, '<N>');

  // Truncate to 200 chars, trim
  normalized = normalized.slice(0, 200).trim();

  return normalized;
}

/**
 * Search error KB for similar errors with resolutions
 * REQ-RTA-402: 3-stage search (exact → prefix → vector)
 * Returns: { error_normalized, resolution, resolved_by, tool_sequence, use_count } | null
 */
export async function searchErrorKB(normalizedError) {
  if (!normalizedError) return null;

  try {
    const db = getDb();

    // Stage 1: Exact text match
    const exactMatch = db.prepare(`
      SELECT * FROM error_kb
      WHERE error_normalized = ? AND resolution IS NOT NULL
      ORDER BY use_count DESC, ts DESC
      LIMIT 1
    `).get(normalizedError);

    if (exactMatch) {
      // Update use stats
      db.prepare(`
        UPDATE error_kb
        SET use_count = use_count + 1, last_used = ?
        WHERE id = ?
      `).run(new Date().toISOString(), exactMatch.id);

      // Fetch updated record
      return db.prepare('SELECT * FROM error_kb WHERE id = ?').get(exactMatch.id);
    }

    // Stage 2: Prefix match (first 30 chars + LIKE, length ratio ≥ 0.7)
    const prefix = normalizedError.slice(0, 30);
    const minLength = Math.floor(normalizedError.length * 0.7);
    const maxLength = Math.ceil(normalizedError.length / 0.7);

    const prefixMatches = db.prepare(`
      SELECT * FROM error_kb
      WHERE error_normalized LIKE ? || '%'
        AND resolution IS NOT NULL
        AND LENGTH(error_normalized) BETWEEN ? AND ?
      ORDER BY use_count DESC, ts DESC
    `).all(prefix, minLength, maxLength);

    if (prefixMatches.length > 0) {
      const match = prefixMatches[0];
      db.prepare(`
        UPDATE error_kb
        SET use_count = use_count + 1, last_used = ?
        WHERE id = ?
      `).run(new Date().toISOString(), match.id);

      // Fetch updated record
      return db.prepare('SELECT * FROM error_kb WHERE id = ?').get(match.id);
    }

    // Stage 3: Vector fallback
    const embeddings = await generateEmbeddings([normalizedError]);
    if (!embeddings || embeddings.length === 0) return null;

    const vectorResults = vectorSearch('error_kb', 'vec_error_kb', embeddings[0], 3);

    // Filter for resolution not null
    const withResolution = vectorResults.filter(r => r.resolution != null);
    if (withResolution.length === 0) return null;

    const best = withResolution[0];

    // Distance thresholds
    if (best.distance >= 0.85) return null; // Too dissimilar

    // High confidence: < 0.76
    if (best.distance < 0.76) {
      db.prepare(`
        UPDATE error_kb
        SET use_count = use_count + 1, last_used = ?
        WHERE id = ?
      `).run(new Date().toISOString(), best.id);

      // Fetch updated record
      return db.prepare('SELECT * FROM error_kb WHERE id = ?').get(best.id);
    }

    // Medium confidence: 0.76-0.85 (keyword verification required)
    // For now, return the match (hook can decide to verify)
    db.prepare(`
      UPDATE error_kb
      SET use_count = use_count + 1, last_used = ?
      WHERE id = ?
    `).run(new Date().toISOString(), best.id);

    // Fetch updated record
    return db.prepare('SELECT * FROM error_kb WHERE id = ?').get(best.id);
  } catch {
    // Silently handle all errors
    return null;
  }
}

/**
 * Record error resolution in KB
 * REQ-RTA-403: UPSERT with use_count increment
 * details: { error_raw, resolved_by, tool_sequence }
 */
export function recordResolution(normalizedError, details) {
  if (!normalizedError || !details) return;

  try {
    const db = getDb();
    const { error_raw, resolved_by, tool_sequence } = details;

    db.prepare(`
      INSERT INTO error_kb (
        ts, error_normalized, error_raw, resolution, resolved_by, tool_sequence, use_count
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(error_normalized) DO UPDATE SET
        ts = excluded.ts,
        error_raw = excluded.error_raw,
        resolution = excluded.resolution,
        resolved_by = excluded.resolved_by,
        tool_sequence = excluded.tool_sequence,
        use_count = use_count + 1
    `).run(
      new Date().toISOString(),
      normalizedError,
      error_raw || null,
      JSON.stringify(details),
      resolved_by || null,
      tool_sequence || null
    );
  } catch {
    // Silently handle all errors
  }
}

/**
 * Generate embeddings for error_kb entries without vectors
 * REQ-RTA-404: Batch embedding generation
 */
export async function generateErrorEmbeddings() {
  try {
    const db = getDb();

    // Find entries without embeddings
    const unembedded = db.prepare(`
      SELECT id, error_normalized
      FROM error_kb
      WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)
    `).all();

    if (unembedded.length === 0) return;

    // Generate embeddings
    const texts = unembedded.map(r => r.error_normalized);
    const embeddings = await generateEmbeddings(texts);

    if (!embeddings || embeddings.length === 0) return;

    // Insert into vec_error_kb (DELETE+INSERT pattern to avoid conflicts)
    const insertStmt = db.prepare(`
      INSERT INTO vec_error_kb (error_kb_id, embedding) VALUES (?, ?)
    `);

    for (let i = 0; i < unembedded.length; i++) {
      if (!embeddings[i]) continue; // Skip failed embeddings

      try {
        const embeddingBlob = Buffer.from(new Float32Array(embeddings[i]).buffer);

        // Delete existing (if any) then insert
        db.prepare('DELETE FROM vec_error_kb WHERE error_kb_id = ?').run(unembedded[i].id);
        insertStmt.run(unembedded[i].id, embeddingBlob);
      } catch {
        // Skip this entry, continue with others
        continue;
      }
    }
  } catch {
    // Silently handle all errors
  }
}
