import { createConnection } from 'net';
import { spawn } from 'child_process';
import { join } from 'path';

const SOCKET_PATH = '/tmp/self-gen-embed.sock';
const TIMEOUT_MS = 10000; // 10 seconds
const HEALTH_TIMEOUT_MS = 500;

function _sendRequest(texts) {
  return new Promise((resolve, reject) => {
    const conn = createConnection(SOCKET_PATH);
    let data = '';
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('Embedding server timeout')); }, TIMEOUT_MS);
    conn.on('connect', () => { conn.write(JSON.stringify({ action: 'embed', texts }) + '\n'); });
    conn.on('data', chunk => { data += chunk; });
    conn.on('end', () => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(data.trim());
        if (res.embeddings) resolve(res.embeddings);
        else reject(new Error(res.error || 'No embeddings'));
      } catch (e) { reject(e); }
    });
    conn.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function isServerRunning() {
  return new Promise((resolve) => {
    const conn = createConnection(SOCKET_PATH);
    const timer = setTimeout(() => { conn.destroy(); resolve(false); }, HEALTH_TIMEOUT_MS);
    conn.on('connect', () => { conn.write(JSON.stringify({ action: 'health' }) + '\n'); });
    let data = '';
    conn.on('data', chunk => { data += chunk; });
    conn.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.trim()).status === 'ok'); }
      catch { resolve(false); }
    });
    conn.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

export async function startServer() {
  const serverPath = join(process.env.HOME, '.self-generation', 'lib', 'embedding-server.mjs');
  const child = spawn('node', [serverPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

export async function embedViaServer(texts) {
  try {
    return await _sendRequest(texts);
  } catch (e) {
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOENT') {
      await startServer();
      await new Promise(r => setTimeout(r, 5000));
      return await _sendRequest(texts); // One retry
    }
    throw e;
  }
}
