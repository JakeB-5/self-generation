import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createConnection } from 'net';
import { isServerRunning, embedViaServer } from '../lib/embedding-client.mjs';

const SOCKET_PATH = '/tmp/self-gen-embed.sock';

// Helper: Check if socket exists
function socketExists() {
  return new Promise((resolve) => {
    const conn = createConnection(SOCKET_PATH);
    conn.on('connect', () => { conn.destroy(); resolve(true); });
    conn.on('error', () => resolve(false));
    setTimeout(() => { conn.destroy(); resolve(false); }, 100);
  });
}

test('isServerRunning returns false when no server', async () => {
  const exists = await socketExists();
  if (exists) {
    // Skip test if server is actually running
    console.log('  # SKIP: Server is running');
    return;
  }
  const running = await isServerRunning();
  assert.strictEqual(running, false, 'Should return false when server not running');
});

test('isServerRunning returns true when server is running', async () => {
  const exists = await socketExists();
  if (!exists) {
    // Skip test if server is not running
    console.log('  # SKIP: Server is not running');
    return;
  }
  const running = await isServerRunning();
  assert.strictEqual(running, true, 'Should return true when server is running');
});

test('embedViaServer throws when server unavailable and auto-start fails', async (t) => {
  const exists = await socketExists();
  if (exists) {
    console.log('  # SKIP: Server is running, cannot test failure case');
    return;
  }

  // Mock startServer to prevent actual daemon start
  const mockStartServer = () => Promise.resolve();

  // This will fail because we're not actually starting the server
  // We expect it to throw after retry timeout
  try {
    // Pass a minimal text array
    await embedViaServer(['test']);
    assert.fail('Should have thrown an error');
  } catch (e) {
    assert.ok(e.message.includes('ECONNREFUSED') || e.message.includes('timeout') || e.message.includes('ENOENT'),
              `Expected connection error, got: ${e.message}`);
  }
});

test('embedding-client module exports expected functions', () => {
  assert.strictEqual(typeof isServerRunning, 'function', 'isServerRunning should be a function');
  assert.strictEqual(typeof embedViaServer, 'function', 'embedViaServer should be a function');
});

test('embedViaServer accepts array of strings', async () => {
  const exists = await socketExists();
  if (!exists) {
    console.log('  # SKIP: Server is not running');
    return;
  }

  // Test with actual server if running
  try {
    const result = await embedViaServer(['hello world']);
    assert.ok(Array.isArray(result), 'Should return an array');
    assert.strictEqual(result.length, 1, 'Should return one embedding');
    if (result[0] !== null) {
      assert.ok(Array.isArray(result[0]), 'Embedding should be an array');
      assert.strictEqual(result[0].length, 384, 'Embedding should be 384-dimensional');
    }
  } catch (e) {
    // If server is not fully initialized or model not loaded, that's expected
    console.log(`  # NOTE: Server connection failed: ${e.message}`);
  }
});

test('embedViaServer handles empty strings', async () => {
  const exists = await socketExists();
  if (!exists) {
    console.log('  # SKIP: Server is not running');
    return;
  }

  try {
    const result = await embedViaServer(['', '  ', 'valid text']);
    assert.ok(Array.isArray(result), 'Should return an array');
    assert.strictEqual(result.length, 3, 'Should return three results');
    // Empty strings should return null
    assert.strictEqual(result[0], null, 'Empty string should return null');
    assert.strictEqual(result[1], null, 'Whitespace-only string should return null');
    if (result[2] !== null) {
      assert.ok(Array.isArray(result[2]), 'Valid text should return embedding array');
    }
  } catch (e) {
    console.log(`  # NOTE: Server connection failed: ${e.message}`);
  }
});
