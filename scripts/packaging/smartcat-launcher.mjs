/**
 * Smart-CAT Studio portable launcher — starts Okapi, MT sidecar, and Node API+UI.
 * Run via: runtime/node/node.exe scripts/packaging/smartcat-launcher.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '../..');
const RUNTIME_NODE = path.join(APP_ROOT, 'runtime', 'node', 'node.exe');
const RUNTIME_PYTHON = path.join(APP_ROOT, 'runtime', 'python', 'python.exe');

const nodeExe = fs.existsSync(RUNTIME_NODE) ? RUNTIME_NODE : process.execPath;
const pythonExe = fs.existsSync(RUNTIME_PYTHON) ? RUNTIME_PYTHON : 'python';

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function spawnService(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'ignore',
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    windowsHide: true,
  });
  child.on('error', (err) => {
    log(`[ERROR] ${label} 启动失败: ${err.message}`);
  });
  children.push(child);
  return child;
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function ensureDataDir() {
  const dataDir = path.join(APP_ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(APP_ROOT, 'smartcat-db-path.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify({ databaseFile: './data/smartcat-local.db' }, null, 2)}\n`,
      'utf8'
    );
  }
}

function openBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  }).unref();
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    killProcessTree(child);
  }
}

function registerShutdownHandlers() {
  const shutdown = (code = 0) => {
    cleanup();
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('exit', cleanup);
}

async function main() {
  registerShutdownHandlers();
  ensureDataDir();

  log('Smart-CAT Studio 便携版启动中…');
  log(`应用目录: ${APP_ROOT}`);

  if (!fs.existsSync(nodeExe)) {
    log('[ERROR] 未找到 Node 运行时。请确认 runtime/node/node.exe 存在。');
    process.exit(1);
  }
  if (!fs.existsSync(pythonExe)) {
    log('[WARN] 未找到内嵌 Python，将尝试系统 python 命令。');
  }

  const okapiDir = path.join(APP_ROOT, 'scripts', 'okapi-sidecar');
  const mtDir = path.join(APP_ROOT, 'scripts', 'translators-server');

  log('[1/4] 启动 Okapi sidecar (8090)…');
  spawnService(
    'Okapi',
    pythonExe,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8090'],
    { cwd: okapiDir }
  );

  log('[2/4] 启动 MT 参考服务 (8770)…');
  spawnService(
    'MT',
    pythonExe,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8770'],
    { cwd: mtDir, env: { MT_REF_PREACCELERATE: '0' } }
  );

  log('[3/4] 启动 Smart-CAT 主服务 (58741)…');
  spawnService('主服务', nodeExe, ['server/index.mjs'], {
    cwd: APP_ROOT,
    env: {
      SMARTCAT_SERVE_STATIC: '1',
      SMARTCAT_LOCAL_DB_PORT: '58741',
      SMARTCAT_PACKAGE_MODE: 'portable',
    },
  });

  const checks = [
    ['Okapi', 'http://127.0.0.1:8090/health'],
    ['MT 参考', 'http://127.0.0.1:8770/health'],
    ['主服务', 'http://127.0.0.1:58741/api/health'],
  ];

  for (const [name, url] of checks) {
    process.stdout.write(`等待 ${name} 就绪…`);
    const ok = await waitForHealth(url);
    log(ok ? ' OK' : ' 超时');
    if (!ok) {
      log(`[ERROR] ${name} 在 60 秒内未就绪。请检查端口占用或杀毒软件拦截。`);
      cleanup();
      process.exit(1);
    }
  }

  log('[4/4] 打开浏览器…');
  openBrowser('http://127.0.0.1:58741');
  log('');
  log('Smart-CAT Studio 已运行。关闭此窗口将停止全部服务。');

  await new Promise(() => {
    /* keep launcher alive until console closed or SIGINT */
  });
}

main().catch((err) => {
  log(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  cleanup();
  process.exit(1);
});
