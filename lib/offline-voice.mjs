import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export function createOfflineVoice(root) {
  const python = process.env.JERMI_VOICE_PYTHON || path.join(root, '.venv', 'Scripts', 'python.exe');
  const model = process.env.JERMI_VOICE_MODEL || path.join(root, '.local-models', 'vosk-model-small-en-us-0.15');
  const listener = path.join(root, 'scripts', 'offline_voice.py');
  const speaker = path.join(root, 'scripts', 'offline_speak.ps1');
  let active = null;
  let cachedStatus = null;
  let statusAt = 0;

  function run(executable, args, input = '', timeoutMs = 30000, track = true) {
    if (track && active) throw Object.assign(new Error('A voice action is already in progress.'), { status: 409 });
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      if (track) active = child;
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 20_000) child.kill(); });
      child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 20_000) child.kill(); });
      child.on('error', error => { clearTimeout(timer); if (active === child) active = null; reject(error); });
      child.on('close', code => {
        clearTimeout(timer); if (active === child) active = null;
        if (code === 0) resolve(stdout.trim());
        else {
          let message = stderr.trim().slice(-500) || 'The local voice service stopped.';
          try { message = JSON.parse(stdout).error || message; } catch {}
          reject(Object.assign(new Error(message), { status: code === null ? 409 : 503 }));
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }

  async function status() {
    if (cachedStatus && Date.now() - statusAt < 15_000) return cachedStatus;
    try {
      await Promise.all([access(python), access(model), access(listener), access(speaker)]);
      const result = JSON.parse(await run(python, [listener, 'status', model], '', 8000, false));
      cachedStatus = { ...result, offline: true };
    } catch (error) {
      cachedStatus = { ready: false, offline: true, reason: error.message || 'Set up the local voice model.' };
    }
    statusAt = Date.now();
    return cachedStatus;
  }

  async function listen() {
    const available = await status();
    if (!available.ready) throw Object.assign(new Error(available.reason || 'Offline microphone is unavailable.'), { status: 503 });
    const result = JSON.parse(await run(python, [listener, 'listen', model], '', 32000));
    if (result.error) throw Object.assign(new Error(result.error), { status: 503 });
    return { text: String(result.text || '').slice(0, 2000) };
  }

  async function speak(text) {
    const message = String(text || '').replace(/\[(\d+)\]/g, ' source $1 ').slice(0, 1300);
    if (!message.trim()) return { ok: true };
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', speaker], message, 45000);
    return { ok: true };
  }

  function stop() { if (active) active.kill(); active = null; return { ok: true }; }
  return { status, listen, speak, stop };
}
