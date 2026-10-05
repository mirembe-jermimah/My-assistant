// Optional live integration check. Requires Ollama and qwen3:1.7b locally.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'jermi-live-model-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], { cwd: repo,
  env: { ...process.env, PORT: String(port), JERMI_DATA_DIR: scratch,
    JERMI_FS_ROOTS: path.join(repo, 'tests', 'fixtures'), JERMI_LOCAL_MODEL: 'qwen3:1.7b',
    OPENAI_API_KEY: '', JERMI_DISABLE_POWER: '1', JERMI_DISABLE_AUTO_SCAN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += String(chunk); });
let cookie = '', csrf = '';
async function call(route, method = 'GET', body) {
  const response = await fetch(base + route, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, signal: AbortSignal.timeout(180000) });
  const data = await response.json();
  assert.equal(response.status, method === 'POST' && route === '/api/pc/scan' ? 202 : 200, JSON.stringify(data));
  return { response, data };
}
try {
  for (let i = 0; i < 1200; i++) {
    if (child.exitCode !== null) throw new Error(stderr);
    try { if ((await fetch(base + '/api/session')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const setup = await call('/api/setup', 'POST', { password: 'JermiLiveModelTest2026!' });
  csrf = setup.data.csrf; cookie = setup.response.headers.get('set-cookie').split(';')[0];
  await call('/api/pc/scan', 'POST', { path: path.join(repo, 'tests', 'fixtures') });
  for (let i = 0; i < 300; i++) {
    const status = (await call('/api/pc/scan')).data;
    if (!status.running) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const answer = (await call('/api/chat', 'POST', { message: 'When does the cobalt team meet?' })).data;
  assert.match(answer.content, /Tuesday/i);
  assert.match(answer.content, /10/);
  assert.ok(answer.citations.some(item => item.name === 'meeting-note.txt'));
  console.log('Passed: real local model answered from a PC file with a source citation.');
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  const actual = await realpath(scratch);
  if (path.dirname(actual) !== await realpath(tmpdir()) || !path.basename(actual).startsWith('jermi-live-model-')) throw new Error('Unsafe test cleanup path');
  await rm(actual, { recursive: true });
}
