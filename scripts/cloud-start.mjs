/**
 * Cloud container entry: start Okapi (8090) + MT reference (8770) sidecars, then Node API.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const okapiDir = path.join(projectRoot, 'scripts', 'okapi-sidecar');
const mtDir = path.join(projectRoot, 'scripts', 'translators-server');
const OKAPI_PORT = Number(process.env.OKAPI_PORT || 8090);
const OKAPI_HOST = process.env.OKAPI_HOST || '127.0.0.1';
const OKAPI_URL = `http://${OKAPI_HOST}:${OKAPI_PORT}`;
const MT_PORT = Number(process.env.MT_PORT || 8770);
const MT_HOST = process.env.MT_HOST || '127.0.0.1';
const MT_URL = `http://${MT_HOST}:${MT_PORT}`;
const HEALTH_TIMEOUT_MS = 60_000;
const POLL_MS = 500;

let okapiProc = null;
let mtProc = null;
let nodeProc = null;
let shuttingDown = false;

function log(msg) {
  console.log(`[cloud-start] ${msg}`);
}

async function waitForHealth(url, label) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const headers = {};
  const apiKey = process.env.MT_REF_API_KEY?.trim();
  if (label === 'MT' && apiKey) headers['X-API-Key'] = apiKey;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (payload.ok) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

function startOkapi() {
  log(`Starting Okapi sidecar at ${OKAPI_URL}…`);
  okapiProc = spawn(
    'python3',
    ['-m', 'uvicorn', 'main:app', '--host', OKAPI_HOST, '--port', String(OKAPI_PORT)],
    {
      cwd: okapiDir,
      stdio: 'inherit',
      env: { ...process.env, OKAPI_PORT: String(OKAPI_PORT) },
    }
  );
  okapiProc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(`Okapi exited (code=${code}, signal=${signal}). Shutting down.`);
    shutdown(code ?? 1);
  });
}

function startMtReference() {
  log(`Starting MT reference sidecar at ${MT_URL}…`);
  mtProc = spawn(
    'python3',
    ['-m', 'uvicorn', 'main:app', '--host', MT_HOST, '--port', String(MT_PORT)],
    {
      cwd: mtDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        MT_REF_PREACCELERATE: process.env.MT_REF_PREACCELERATE ?? '0',
      },
    }
  );
  mtProc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(`MT reference exited (code=${code}, signal=${signal}). Shutting down.`);
    shutdown(code ?? 1);
  });
}

function startNode() {
  log('Starting Node API…');
  nodeProc = spawn('node', ['server/index.mjs'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  nodeProc.on('exit', (code, signal) => {
    log(`Node API exited (code=${code}, signal=${signal}).`);
    shutdown(code ?? 0);
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (nodeProc && !nodeProc.killed) nodeProc.kill('SIGTERM');
  if (okapiProc && !okapiProc.killed) okapiProc.kill('SIGTERM');
  if (mtProc && !mtProc.killed) mtProc.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startOkapi();
startMtReference();

const [okapiReady, mtReady] = await Promise.all([
  waitForHealth(OKAPI_URL, 'Okapi'),
  waitForHealth(MT_URL, 'MT'),
]);

if (!okapiReady) {
  log(`Okapi did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s.`);
  shutdown(1);
} else if (!mtReady) {
  log(`MT reference did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s.`);
  shutdown(1);
} else {
  log('Okapi and MT reference are ready.');
  startNode();
}
