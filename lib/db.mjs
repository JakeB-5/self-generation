// ~/.self-generation/lib/db.mjs
// Core database module — config, DB connection, CRUD, vector search

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// --- Constants (dynamically evaluated to support test HOME override) ---
function getGlobalDir() {
  return join(process.env.HOME, '.self-generation');
}
function getDataDir() {
  return join(getGlobalDir(), 'data');
}
function getDbPath() {
  return join(getDataDir(), 'self-gen.db');
}

// Legacy exports for backward compatibility
const GLOBAL_DIR = getGlobalDir();
const DATA_DIR = getDataDir();
const DB_PATH = getDbPath();
const RETENTION_DAYS = 90;

// Config schema default constants (REQ-INF-104)
const ANALYSIS_DAYS = 7;
const ANALYSIS_CACHE_MAX_AGE_HOURS = 24;
const DEFAULT_DB_PATH = join(process.env.HOME, '.self-generation', 'data', 'self-gen.db');
const DEFAULT_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DEFAULT_EMBEDDING_DIMENSIONS = 384;
const DEFAULT_EMBEDDING_THRESHOLD = 0.76;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_SOCKET_PATH = '/tmp/self-gen-embed.sock';
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const DEFAULT_CLIENT_TIMEOUT_MS = 10000;

// Vector table registry for extensible vector search
const VEC_TABLE_REGISTRY = {
  error_kb:         { vecTable: 'vec_error_kb',          fkColumn: 'error_kb_id' },
  skill_embeddings: { vecTable: 'vec_skill_embeddings',  fkColumn: 'skill_id' }
};

export {
  GLOBAL_DIR, DATA_DIR, DB_PATH, RETENTION_DAYS,
  ANALYSIS_DAYS, ANALYSIS_CACHE_MAX_AGE_HOURS,
  DEFAULT_DB_PATH, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_THRESHOLD, DEFAULT_BATCH_SIZE, DEFAULT_SOCKET_PATH,
  DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_CLIENT_TIMEOUT_MS,
  VEC_TABLE_REGISTRY
};

// --- Config functions (REQ-INF-102, REQ-INF-103) ---

/**
 * Load config.json from GLOBAL_DIR.
 * Returns parsed object or {} on file-not-found / parse error.
 */
export function loadConfig() {
  const configPath = join(getGlobalDir(), 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Check if system is enabled via config.enabled field.
 * Returns true by default (config.enabled !== false).
 */
export function isEnabled() {
  const config = loadConfig();
  return config.enabled !== false;
}

// --- DB Connection ---

let _db = null;

/**
 * Reset DB singleton (for testing only)
 * Closes existing connection and clears singleton
 */
export function resetDb() {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
}

/**
 * DB connection singleton (WAL mode, sqlite-vec loaded)
 * All hooks and modules share the same connection via getDb()
 */
export function getDb() {
  if (_db) return _db;

  const dataDir = getDataDir();
  const dbPath = getDbPath();

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');

  // Load sqlite-vec extension for vector search
  sqliteVec.load(_db);

  // Skip DDL if tables already exist (saves ~5-10ms per hook invocation)
  const eventsExists = _db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
  ).get();
  const vecExists = _db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_error_kb'"
  ).get();
  if (!eventsExists || !vecExists) initDb(_db);

  // v8→v9 migration
  migrateV9(_db);

  return _db;
}

/**
 * DB schema initialization (CREATE IF NOT EXISTS)
 */
export function initDb(db) {
  db.exec(`
    -- Events table (replaces prompt-log.jsonl)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      v INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project TEXT,
      project_path TEXT,
      data JSON NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_project_type ON events(project_path, type, ts);
    CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
    CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type);

    -- Error KB table (replaces error-kb.jsonl)
    CREATE TABLE IF NOT EXISTS error_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      error_normalized TEXT NOT NULL,
      error_raw TEXT,
      resolution TEXT,
      resolved_by TEXT,
      tool_sequence TEXT,
      use_count INTEGER DEFAULT 0,
      last_used TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_error_kb_error ON error_kb(error_normalized);

    -- Feedback table (replaces feedback.jsonl)
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      v INTEGER DEFAULT 1,
      ts TEXT NOT NULL,
      suggestion_id TEXT NOT NULL,
      action TEXT NOT NULL,
      suggestion_type TEXT,
      summary TEXT
    );

    -- Analysis cache table (replaces analysis-cache.json)
    CREATE TABLE IF NOT EXISTS analysis_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      project TEXT,
      days INTEGER,
      input_hash TEXT,
      analysis JSON NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_cache_hash
      ON analysis_cache(project, days, input_hash);

    -- Skill embeddings table (for vector skill matching)
    CREATE TABLE IF NOT EXISTS skill_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      source_path TEXT NOT NULL,
      description TEXT,
      keywords TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  // FTS5 virtual table for events text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      type, text, content='events', content_rowid='id'
    );

    -- Triggers to keep FTS5 index in sync with events table
    CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, type, text)
      VALUES (NEW.id, NEW.type,
        COALESCE(json_extract(NEW.data, '$.text'), json_extract(NEW.data, '$.error')));
    END;

    CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, type, text)
      VALUES ('delete', OLD.id, OLD.type,
        COALESCE(json_extract(OLD.data, '$.text'), json_extract(OLD.data, '$.error')));
    END;

    -- Enforce INSERT-only constraint (prevents FTS desync from accidental UPDATEs)
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN
      SELECT RAISE(ABORT, 'events table is INSERT-only. UPDATE is prohibited to maintain FTS5 consistency.');
    END;
  `);

  // vec0 virtual tables — wrapped in individual try-catch
  // because IF NOT EXISTS behavior may vary across sqlite-vec versions
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_error_kb USING vec0(
      error_kb_id INTEGER PRIMARY KEY, embedding float[384]
    )`);
  } catch { /* Table already exists or vec0 unavailable */ }

  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_skill_embeddings USING vec0(
      skill_id INTEGER PRIMARY KEY, embedding float[384]
    )`);
  } catch { /* Table already exists or vec0 unavailable */ }
}

/**
 * v8→v9 schema migration (idempotent)
 * Adds input_hash column and ensures events_fts exists.
 */
function migrateV9(db) {
  const columns = db.prepare("PRAGMA table_info('analysis_cache')").all();
  const hasInputHash = columns.some(c => c.name === 'input_hash');
  if (!hasInputHash && columns.length > 0) {
    db.exec('ALTER TABLE analysis_cache ADD COLUMN input_hash TEXT');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_cache_hash
      ON analysis_cache(project, days, input_hash)`);
  }

  // Ensure events_fts exists (may be missing on v8 databases)
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='events_fts'"
  ).get();
  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        type, text, content='events', content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(rowid, type, text)
        VALUES (NEW.id, NEW.type,
          COALESCE(json_extract(NEW.data, '$.text'), json_extract(NEW.data, '$.error')));
      END;
      CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, type, text)
        VALUES ('delete', OLD.id, OLD.type,
          COALESCE(json_extract(OLD.data, '$.text'), json_extract(OLD.data, '$.error')));
      END;
    `);
    // Backfill existing events into FTS index
    db.exec(`
      INSERT INTO events_fts(rowid, type, text)
      SELECT id, type, COALESCE(json_extract(data, '$.text'), json_extract(data, '$.error'))
      FROM events WHERE type IN ('prompt', 'tool_error');
    `);
  }
}

// --- Project identification ---

export function getProjectName(cwd) {
  return cwd ? cwd.split('/').filter(Boolean).pop() : 'unknown';
}

/**
 * Project root path (canonical identifier)
 * Prefers CLAUDE_PROJECT_DIR env var (cwd may be a subdirectory)
 */
export function getProjectPath(cwd) {
  return process.env.CLAUDE_PROJECT_DIR || cwd;
}

// --- Event CRUD ---

/**
 * Insert event into events table (replaces appendEntry)
 */
export function insertEvent(entry) {
  const db = getDb();
  const { v = 1, type, ts, sessionId, project, projectPath, ...rest } = entry;
  db.prepare(`
    INSERT INTO events (v, type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(v, type, ts, sessionId, project, projectPath, JSON.stringify(rest));
}

/**
 * Query events with SQL indexed filtering (replaces readEntries)
 * Returns flat entry format (data JSON spread to top level)
 */
export function queryEvents(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters.sessionId) {
    conditions.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.projectPath) {
    conditions.push('project_path = ?');
    params.push(filters.projectPath);
  }
  if (filters.project) {
    conditions.push('project = ?');
    params.push(filters.project);
  }
  if (filters.since) {
    conditions.push('ts >= ?');
    params.push(filters.since);
  }

  // FTS5 full-text search
  if (filters.search) {
    conditions.push('id IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)');
    params.push(filters.search);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? `LIMIT ${Number(filters.limit)}` : '';

  const rows = db.prepare(`
    SELECT * FROM events ${where} ORDER BY ts DESC ${limit}
  `).all(...params);

  // Reconstruct flat entry format for backward compatibility
  return rows.map(row => ({
    v: row.v,
    type: row.type,
    ts: row.ts,
    sessionId: row.session_id,
    project: row.project,
    projectPath: row.project_path,
    ...JSON.parse(row.data)
  }));
}

/**
 * Session events convenience function
 */
export function getSessionEvents(sessionId, limit) {
  return queryEvents({ sessionId, limit });
}

/**
 * Delete old events beyond retention period
 */
export function pruneOldEvents(retentionDays) {
  if (retentionDays === undefined) {
    const config = loadConfig();
    retentionDays = config.retentionDays || RETENTION_DAYS;
  }
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
  db.prepare('DELETE FROM error_kb WHERE ts < ? AND use_count = 0').run(cutoff);
}

// --- Utility functions ---

/**
 * Read stdin as JSON (async, with 5s timeout)
 * Claude Code hooks pass JSON data via stdin
 */
export function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => reject(new Error('stdin timeout')), 5000);
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
    process.stdin.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

/**
 * Strip <private>...</private> tags from text
 * Content wrapped in private tags is not stored in DB
 */
export function stripPrivateTags(text) {
  if (!text) return text;
  return text.replace(/<private>[\s\S]*?<\/private>/gi, '[PRIVATE]').trim();
}

// --- Embedding functions ---

/**
 * Generate embeddings via daemon socket client
 * Returns empty array if server unavailable (text matching fallback)
 */
export async function generateEmbeddings(texts) {
  if (!texts || texts.length === 0) return [];

  try {
    const { embedViaServer } = await import('./embedding-client.mjs');
    return await embedViaServer(texts);
  } catch {
    return []; // Server not available, fall through to text matching
  }
}

/**
 * Vector similarity search (2-step query)
 * Step 1: KNN search on vec0 virtual table for IDs + distance
 * Step 2: Fetch full records from source table by IDs
 */
export function vectorSearch(table, vecTable, queryEmbedding, limit = 5) {
  const db = getDb();
  const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
  const registry = VEC_TABLE_REGISTRY[table];
  if (!registry) return [];

  // Step 1: KNN search on vec0
  const vecResults = db.prepare(`
    SELECT ${registry.fkColumn}, distance FROM ${registry.vecTable}
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance
  `).all(embeddingBlob, limit);
  if (vecResults.length === 0) return [];

  // Step 2: Fetch full records by IDs
  const ids = vecResults.map(r => r[registry.fkColumn]);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).all(...ids);

  // Merge distance and preserve order
  const distMap = Object.fromEntries(vecResults.map(r => [r[registry.fkColumn], r.distance]));
  return rows.map(r => ({ ...r, distance: distMap[r.id] }))
    .sort((a, b) => a.distance - b.distance);
}
