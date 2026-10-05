import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'jermi-pc-flow-'));
const pcRoot = path.join(scratch, 'my-pc'), dataDir = path.join(scratch, 'private-data');
await mkdir(pcRoot);
for (const name of ['meeting-note.txt', 'solar-report.pdf', 'hiring-plan.docx'])
  await copyFile(path.join(repo, 'tests', 'fixtures', name), path.join(pcRoot, name));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { cwd: repo, env: {
  ...process.env, PORT: String(port), JERMI_DATA_DIR: dataDir, JERMI_FS_ROOTS: pcRoot,
  OPENAI_API_KEY: '', JERMI_LOCAL_MODEL: '', JERMI_DISABLE_LOCAL_AI: '1', JERMI_DISABLE_POWER: '1', JERMI_DISABLE_AUTO_SCAN: '1'
}, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '', cookie = '', csrf = '';
server.stderr.on('data', chunk => { stderr += String(chunk); });
async function request(route, { method = 'GET', body, headers = {} } = {}) {
  return fetch(base + route, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: {
    ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers
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
  assert.equal((await json(await request('/api/session'))).configured, false);
  assert.equal((await request('/api/pc/roots')).status, 401);
  await json(await request('/api/setup', { method: 'POST', body: { password: 'short' } }), 400);
  const setup = await request('/api/setup', { method: 'POST', body: { password: 'JermiLocalTest2026!' } });
  csrf = (await json(setup)).csrf; cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await json(await request('/api/session'))).authenticated, true);
  const voiceStatus = await json(await request('/api/voice/status'));
  assert.equal(voiceStatus.offline, true);
  assert.equal(typeof voiceStatus.ready, 'boolean');
  await json(await request('/api/voice/speak', { method: 'POST', body: { text: '' } }));
  await json(await request('/api/voice/stop', { method: 'POST', body: {} }));
  assert.equal((await request('/api/voice/speak', { method: 'POST', body: { text: 'blocked' }, headers: { 'x-csrf-token': '' } })).status, 403);
  assert.equal((await request('/api/documents', { method: 'POST', body: {} })).status, 404);
  assert.equal((await json(await request('/api/pc/roots'))).roots[0].path, await realpath(pcRoot));
  const listing = await json(await request(`/api/pc/list?path=${encodeURIComponent(pcRoot)}`));
  assert.ok(listing.entries.some(item => item.name === 'meeting-note.txt'));
  assert.equal(listing.total, 3);
  assert.equal((await json(await request(`/api/pc/list?path=${encodeURIComponent(pcRoot)}&offset=1`))).entries.length, 2);
  assert.match((await json(await request(`/api/pc/file?path=${encodeURIComponent(path.join(pcRoot, 'solar-report.pdf'))}`))).content, /Tuesday inspection/);
  assert.match((await json(await request(`/api/pc/file?path=${encodeURIComponent(path.join(pcRoot, 'hiring-plan.docx'))}`))).content, /Ada as the project owner/);
  assert.equal((await request(`/api/pc/list?path=${encodeURIComponent(tmpdir())}`)).status, 403);
  assert.equal((await request('/api/pc/folders', { method: 'POST', body: { parent: pcRoot, name: 'Blocked' }, headers: { 'x-csrf-token': '' } })).status, 403);
  const folder = await json(await request('/api/pc/folders', { method: 'POST', body: { parent: pcRoot, name: 'Neat' } }), 201);
  assert.equal((await request('/api/pc/folders', { method: 'POST', body: { parent: pcRoot, name: 'Neat' } })).status, 409);
  const fileLocation = await json(await request('/api/chat', { method: 'POST', body: { message: 'Where did I save "meeting-note.txt"?', folder: pcRoot } }));
  assert.match(fileLocation.content, /meeting-note\.txt/);
  assert.match(fileLocation.content, /my-pc/);
  assert.equal(fileLocation.actions[0].path, await realpath(pcRoot));
  const folderLocation = await json(await request('/api/chat', { method: 'POST', body: { message: 'Find the Neat folder', folder: pcRoot } }));
  assert.match(folderLocation.content, /Neat \(folder\)/);
  assert.equal(folderLocation.actions[0].path, folder.path);
  const renamed = await json(await request('/api/pc/rename', { method: 'POST', body: { path: path.join(pcRoot, 'meeting-note.txt'), name: 'meeting-renamed.txt' } }));
  const moved = await json(await request('/api/pc/move', { method: 'POST', body: { path: renamed.path, destination: folder.path } }));
  assert.match(await readFile(moved.path, 'utf8'), /cobalt team/);
  assert.equal((await stat(moved.path)).isFile(), true);
  const names = await json(await request(`/api/pc/search?q=meeting-renamed`));
  assert.ok(names.some(item => item.path === moved.path));
  await json(await request('/api/pc/scan', { method: 'POST', body: { path: pcRoot } }), 202);
  let scan;
  for (let i = 0; i < 200; i++) {
    scan = await json(await request('/api/pc/scan'));
    if (!scan.running) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(scan.running, false);
  assert.ok(scan.indexed >= 3, JSON.stringify(scan));
  const textMatches = await json(await request('/api/pc/search?q=cobalt'));
  assert.ok(textMatches.some(item => item.path === moved.path && item.source === 'content'));
  const answer = await json(await request('/api/chat', { method: 'POST', body: { message: 'What is this about?', path: moved.path } }));
  assert.match(answer.content, /cobalt team/);
  assert.equal(answer.citations[0].path, moved.path);
  assert.ok((await json(await request('/api/messages'))).length >= 2);
  const folderAnswer = await json(await request('/api/chat', { method: 'POST', body: { message: 'List the files in this folder', folder: pcRoot } }));
  assert.match(folderAnswer.content, /solar-report\.pdf/);
  assert.equal(folderAnswer.actions[0].path, await realpath(pcRoot));
  const organizeAnswer = await json(await request('/api/chat', { method: 'POST', body: { message: 'Organize the files in this folder', folder: pcRoot } }));
  assert.equal(organizeAnswer.actions[0].type, 'organizeFolder');
  const plan = await json(await request(`/api/pc/organize-preview?path=${encodeURIComponent(pcRoot)}`));
  assert.ok(plan.items.some(item => item.name === 'solar-report.pdf' && item.category === 'Documents'));
  await json(await request('/api/pc/organize', { method: 'POST', body: { path: pcRoot, items: plan.items, confirm: 'no' } }), 400);
  const organized = await json(await request('/api/pc/organize', { method: 'POST', body: { path: pcRoot, items: plan.items, confirm: 'ORGANIZE' } }));
  assert.equal(organized.failed.length, 0);
  assert.ok(organized.moved.length >= 2);
  assert.equal((await stat(path.join(pcRoot, 'Documents', 'solar-report.pdf'))).isFile(), true);
  assert.ok((await json(await request('/api/pc/search?q=inspection'))).some(item => item.path === path.join(pcRoot, 'Documents', 'solar-report.pdf')));
  if (process.platform === 'win32') {
    await json(await request('/api/pc/shutdown', { method: 'POST', body: { confirm: 'no' } }), 400);
    await json(await request('/api/pc/shutdown', { method: 'POST', body: { confirm: 'SHUT DOWN' } }));
    await json(await request('/api/pc/restart', { method: 'POST', body: { confirm: 'RESTART' } }));
    await json(await request('/api/pc/cancel-shutdown', { method: 'POST', body: {} }));
  }
  await json(await request('/api/logout', { method: 'POST', body: {} }));
  assert.equal((await request('/api/pc/roots')).status, 401);
  console.log('Passed: local drive access, preview, filename/text search, scan, cited chat, folder actions, path/CSRF protection, power confirmation, and sign-out.');
} finally {
  server.kill();
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  const actual = await realpath(scratch);
  if (path.dirname(actual) !== await realpath(tmpdir()) || !path.basename(actual).startsWith('jermi-pc-flow-')) throw new Error('Unsafe test cleanup path');
  await rm(actual, { recursive: true });
}
