/**
 * Cloud container: spawn Okapi Python sidecar (uvicorn) alongside Node API.
 */
import { spawn } from 'child_process';
import path from 'path';

let proc = null;
let started = false;

function parseOkapiUrl(raw) {
  const url = new URL((raw || 'http://127.0.0.1:8090').trim());
  return {
    host: url.hostname || '127.0.0.1',
    port: Number(url.port || 8090),
  };
}

export function startOkapiSidecar(projectRoot) {
  if (started) return proc;
  started = true;

  const { host, port } = parseOkapiUrl(process.env.OKAPI_UPSTREAM_URL);
  const okapiDir = path.join(projectRoot, 'scripts', 'okapi-sidecar');
  const python = process.env.OKAPI_PYTHON?.trim() || 'python3';

  console.log(`[okapi-sidecar] Starting uvicorn at http://${host}:${port} (${python})…`);

  proc = spawn(
    python,
    ['-m', 'uvicorn', 'main:app', '--host', host, '--port', String(port)],
    {
      cwd: okapiDir,
      stdio: 'inherit',
      env: { ...process.env, OKAPI_PORT: String(port) },
    }
  );

  proc.on('error', (err) => {
    console.error('[okapi-sidecar] spawn error:', err);
    proc = null;
    started = false;
  });

  proc.on('exit', (code, signal) => {
    console.error(`[okapi-sidecar] exited (code=${code}, signal=${signal})`);
    proc = null;
    started = false;
  });

  return proc;
}

export async function waitForOkapiSidecar(upstream, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${upstream}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (payload.ok) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
