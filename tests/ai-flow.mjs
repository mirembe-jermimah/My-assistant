import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'jermi-pc-ai-'));
const pcRoot = path.join(scratch, 'my-pc'), dataDir = path.join(scratch, 'private-data');
await mkdir(pcRoot);
await copyFile(path.join(repo, 'tests', 'fixtures', 'meeting-note.txt'), path.join(pcRoot, 'meeting-note.txt'));
let captured;
const mock = createServer(async (req, res) => {
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  let body = '';
  for await (const chunk of req) body += String(chunk);
  captured = JSON.parse(body);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'The cobalt team meets Tuesday at 10am. [1]' }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const mockPort = mock.address().port;
const socket = createSocket();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: {
  ...process.env, PORT: String(port), JERMI_DATA_DIR: dataDir, JERMI_FS_ROOTS: pcRoot,
  OPENAI_API_KEY: 'test-key', JERMI_OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`, JERMI_LOCAL_MODEL: '', JERMI_DISABLE_AUTO_SCAN: '1'
}, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '', cookie = '', csrf = '';
server.stderr.on('data', chunk => { stderr += String(chunk); });
async function request(route, { method = 'GET', body } = {}) {
  return fetch(base + route, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: {
    ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
  } });
}
async function json(response, expected = 200) {
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function waitReady() {
  for (let i = 0; i < 1800; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${stderr}`);
    try { if ((await fetch(base + '/api/session')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${stderr}`);
}
try {
  await waitReady();
  const setup = await request('/api/setup', { method: 'POST', body: { password: 'JermiAITest2026!' } });
  csrf = (await json(setup)).csrf; cookie = setup.headers.get('set-cookie').split(';')[0];
  const session = await json(await request('/api/session'));
  assert.equal(session.aiEnabled, true);
  await json(await request('/api/preferences', { method: 'PUT', body: {
    assistantName: 'Nova', persona: 'Project Manager', tone: 'Friendly', language: 'English (UK)'
  } }));
  await json(await request('/api/pc/scan', { method: 'POST', body: { path: pcRoot } }), 202);
  for (let i = 0; i < 200; i++) {
    const scan = await json(await request('/api/pc/scan'));
    if (!scan.running) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const answer = await json(await request('/api/chat', { method: 'POST', body: { message: 'When does the cobalt team meet?' } }));
  assert.match(answer.content, /Tuesday at 10am/);
  assert.equal(answer.citations[0].name, 'meeting-note.txt');
  assert.match(captured.messages[0].content, /Nova.*Project Manager.*friendly.*English \(UK\)/);
  assert.match(captured.messages.at(-1).content, /cobalt team meets on Tuesday/);
  console.log('Passed: AI conversation receives local file excerpts, preferences, and cited sources.');
} finally {
  server.kill();
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  await new Promise(resolve => mock.close(resolve));
  const actual = await realpath(scratch);
  if (path.dirname(actual) !== await realpath(tmpdir()) || !path.basename(actual).startsWith('jermi-pc-ai-')) throw new Error('Unsafe test cleanup path');
  await rm(actual, { recursive: true });
}
