/**
 * Cloud container: spawn Okapi Python sidecar (uvicorn) alongside Node API.
 */
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
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

function pythonHasUvicorn() {
  const candidates = [
    process.env.OKAPI_PYTHON?.trim(),
    '/usr/local/bin/python3',
    'python3',
  ].filter(Boolean);
  for (const py of candidates) {
    try {
      execSync(`"${py}" -c "import uvicorn"`, { stdio: 'ignore' });
      return py;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Runtime pip install when Render 未走 Docker 构建、或 Start Command 被覆盖时 */
export function ensureOkapiPythonDeps(projectRoot) {
  const existing = pythonHasUvicorn();
  if (existing) return existing;

  const req = path.join(projectRoot, 'scripts', 'okapi-sidecar', 'requirements.txt');
  console.log('[okapi-sidecar] uvicorn not found, installing Python requirements…');
  execSync(`pip3 install --break-system-packages --no-cache-dir -r "${req}"`, {
    stdio: 'inherit',
    env: { ...process.env, PIP_BREAK_SYSTEM_PACKAGES: '1' },
  });

  const after = pythonHasUvicorn();
  if (!after) {
    throw new Error(
      'pip install finished but uvicorn still missing. Check Render logs for pip errors.'
    );
  }
  return after;
}

function resolveUvicornLaunch(okapiDir, host, port) {
  const appArgs = ['main:app', '--host', host, '--port', String(port)];
  const uvicornBin = '/usr/local/bin/uvicorn';
  if (existsSync(uvicornBin)) {
    return { cmd: uvicornBin, args: appArgs };
  }
  const py = pythonHasUvicorn() || 'python3';
  return { cmd: py, args: ['-m', 'uvicorn', ...appArgs] };
}

export function startOkapiSidecar(projectRoot) {
  if (started) return proc;
  started = true;

  const { host, port } = parseOkapiUrl(process.env.OKAPI_UPSTREAM_URL);
  const okapiDir = path.join(projectRoot, 'scripts', 'okapi-sidecar');

  try {
    ensureOkapiPythonDeps(projectRoot);
  } catch (e) {
    console.error('[okapi-sidecar] Python deps failed:', e);
    started = false;
    return null;
  }

  const { cmd, args } = resolveUvicornLaunch(okapiDir, host, port);
  console.log(`[okapi-sidecar] Starting ${cmd} ${args.join(' ')} (cwd=${okapiDir})`);

  proc = spawn(cmd, args, {
    cwd: okapiDir,
    stdio: 'inherit',
    env: { ...process.env, OKAPI_PORT: String(port), PATH: `/usr/local/bin:${process.env.PATH || ''}` },
  });

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
