import { createServer } from 'net';
import { pipeline, env } from '@xenova/transformers';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const SOCKET_PATH = '/tmp/self-gen-embed.sock';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MODELS_DIR = join(process.env.HOME, '.self-generation', 'models');

let extractor = null;
let idleTimer = null;

function resetIdleTimer(server) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    process.stderr.write('[embedding-server] Idle timeout, shutting down\n');
    server.close();
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

async function embed(texts) {
  const results = [];
  for (const text of texts) {
    if (!text || !text.trim()) { results.push(null); continue; }
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vec = Array.from(output.data);
    results.push(vec.every(v => isFinite(v)) ? vec : null);
  }
  return results;
}

async function init() {
  process.stderr.write('[embedding-server] Loading model...\n');
  env.cacheDir = MODELS_DIR;
  extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  process.stderr.write('[embedding-server] Model loaded, ready for requests\n');
}

// Clean stale socket
if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

await init();

const server = createServer((conn) => {
  resetIdleTimer(server);
  let data = '';
  conn.on('data', chunk => { data += chunk; });
  conn.on('end', async () => {
    try {
      const req = JSON.parse(data.trim());
      if (req.action === 'health') {
        conn.end(JSON.stringify({ status: 'ok' }) + '\n');
      } else if (req.action === 'embed') {
        const embeddings = await embed(req.texts || []);
        conn.end(JSON.stringify({ embeddings }) + '\n');
      } else {
        conn.end(JSON.stringify({ error: 'unknown action' }) + '\n');
      }
    } catch (e) {
      try { conn.end(JSON.stringify({ error: e.message }) + '\n'); } catch {}
    }
  });
  conn.on('error', () => {}); // Ignore client disconnect errors
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    process.stderr.write('[embedding-server] Socket already in use, another instance running. Exiting.\n');
    process.exit(0);
  }
  throw e;
});

server.listen(SOCKET_PATH, () => {
  process.stderr.write(`[embedding-server] Listening on ${SOCKET_PATH}\n`);
  resetIdleTimer(server);
});

const shutdown = () => { server.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
