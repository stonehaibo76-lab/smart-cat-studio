import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const EMBED_START_PATH = '/__smartcat/start-embedding';
const MT_REF_START_PATH = '/__smartcat/start-mt-reference';

let embedStarting = false;
let mtRefStarting = false;

async function embeddingAlreadyUp(): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function mtReferenceAlreadyUp(): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:8770/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

type MtReferenceStartOptions = {
  disableStartupPreaccelerate?: boolean;
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer | string) => {
      data += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/** 从 HuggingFace tqdm / 普通日志中提取百分比 */
function parsePercent(line: string): number | null {
  const matches = [...line.matchAll(/(\d{1,3})%/g)];
  if (matches.length === 0) return null;
  const n = parseInt(matches[matches.length - 1][1], 10);
  if (Number.isNaN(n) || n > 100) return null;
  return n;
}

function streamLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void) {
  if (!stream) return;
  let buf = '';
  stream.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.length) onLine(line);
    }
  });
  stream.on('end', () => {
    const tail = buf.replace(/\r$/, '');
    if (tail.trim().length) onLine(tail);
  });
}

type SseEvent = 'log' | 'progress' | 'done';

function sseWrite(res: ServerResponse, event: SseEvent, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function emitLog(res: ServerResponse, line: string) {
  sseWrite(res, 'log', { line });
  const pct = parsePercent(line);
  if (pct !== null) sseWrite(res, 'progress', { percent: pct });
}

function checkEmbeddingImport(exe: string, prefix: string[], cwd: string): boolean {
  const r = spawnSync(exe, [...prefix, '-c', 'import sentence_transformers'], {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
  });
  return r.status === 0;
}

function checkTranslatorsImport(exe: string, prefix: string[], cwd: string): boolean {
  const r = spawnSync(exe, [...prefix, '-c', 'import translators'], {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
  });
  return r.status === 0;
}

function ensureVenvPython(
  exe: string,
  prefix: string[],
  cwd: string,
  res: ServerResponse
): { exe: string; prefix: string[] } | null {
  const venvPy = path.join(cwd, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPy)) {
    return { exe: venvPy, prefix: [] };
  }
  sseWrite(res, 'log', { line: '[venv] 正在创建虚拟环境（首次较慢）…' });
  const created = spawnSync(exe, [...prefix, '-m', 'venv', '.venv'], {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
  });
  if (created.status !== 0 || !fs.existsSync(venvPy)) {
    sseWrite(res, 'log', { line: '[ERROR] 无法创建 .venv，请确认已安装 Python 3.10+' });
    return null;
  }
  return { exe: venvPy, prefix: [] };
}

function pyLauncherWorks(cwd: string): boolean {
  return spawnSync('py', ['-3', '-c', 'import sys'], { cwd, windowsHide: true, stdio: 'ignore' }).status === 0;
}

function plainPythonWorks(cwd: string): boolean {
  return spawnSync('python', ['-c', 'import sys'], { cwd, windowsHide: true, stdio: 'ignore' }).status === 0;
}

async function runPipInstall(exe: string, prefix: string[], cwd: string, res: ServerResponse): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(exe, [...prefix, '-m', 'pip', 'install', '-r', 'requirements.txt'], {
      cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
    });
    streamLines(p.stdout, (line) => emitLog(res, line));
    streamLines(p.stderr, (line) => emitLog(res, line));
    p.on('close', (code) => resolve(code ?? 1));
  });
}

async function waitForUvicornHealthy(
  child: ChildProcess,
  timeoutMs: number,
  healthCheck: () => Promise<boolean>
): Promise<boolean> {
  const start = Date.now();
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  while (Date.now() - start < timeoutMs) {
    if (await healthCheck()) {
      return true;
    }
    if (exited) {
      await new Promise((r) => setTimeout(r, 500));
      return healthCheck();
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return healthCheck();
}

async function runEmbeddingServer(
  exe: string,
  prefix: string[],
  cwd: string,
  res: ServerResponse
): Promise<boolean> {
  if (!checkEmbeddingImport(exe, prefix, cwd)) {
    sseWrite(res, 'log', { line: '[pip] 正在安装依赖（首次运行可能较慢）…' });
    const pipCode = await runPipInstall(exe, prefix, cwd, res);
    if (pipCode !== 0) {
      sseWrite(res, 'log', { line: `[ERROR] pip 退出码 ${pipCode}` });
      return false;
    }
  }

  sseWrite(res, 'log', { line: '[uvicorn] 正在启动 main:app → http://127.0.0.1:8765 …' });
  const child = spawn(exe, [...prefix, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8765'], {
    cwd,
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
  });

  streamLines(child.stdout, (line) => emitLog(res, line));
  streamLines(child.stderr, (line) => emitLog(res, line));

  return waitForUvicornHealthy(child, 12 * 60 * 1000, embeddingAlreadyUp);
}

async function runMtReferenceServer(
  exe: string,
  prefix: string[],
  cwd: string,
  res: ServerResponse,
  startOptions: MtReferenceStartOptions = {}
): Promise<boolean> {
  if (!checkTranslatorsImport(exe, prefix, cwd)) {
    sseWrite(res, 'log', { line: '[pip] 正在安装 translators 依赖（首次运行可能较慢）…' });
    const pipCode = await runPipInstall(exe, prefix, cwd, res);
    if (pipCode !== 0) {
      sseWrite(res, 'log', { line: `[ERROR] pip 退出码 ${pipCode}` });
      return false;
    }
  }

  const skipPreaccelerate = startOptions.disableStartupPreaccelerate === true;
  if (skipPreaccelerate) {
    sseWrite(res, 'log', { line: '[config] 已关闭 MT 启动预热（MT_REF_PREACCELERATE=0）' });
  }

  sseWrite(res, 'log', { line: '[uvicorn] 正在启动 main:app → http://127.0.0.1:8770 …' });
  const child = spawn(exe, [...prefix, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8770'], {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      MT_REF_PREACCELERATE: skipPreaccelerate ? '0' : '1',
    },
  });

  streamLines(child.stdout, (line) => emitLog(res, line));
  streamLines(child.stderr, (line) => emitLog(res, line));

  return waitForUvicornHealthy(child, 5 * 60 * 1000, mtReferenceAlreadyUp);
}

async function startEmbeddingFlow(projectRoot: string, res: ServerResponse): Promise<void> {
  const embeddingDir = path.join(projectRoot, 'scripts', 'embedding-server');
  const mainPy = path.join(embeddingDir, 'main.py');
  if (!fs.existsSync(mainPy)) {
    sseWrite(res, 'log', { line: `[ERROR] 未找到 ${mainPy}` });
    sseWrite(res, 'done', { ok: false, error: '未找到 scripts/embedding-server/main.py' });
    return;
  }

  const venvPy = path.join(embeddingDir, '.venv', 'Scripts', 'python.exe');
  let ok = false;

  if (fs.existsSync(venvPy)) {
    sseWrite(res, 'log', { line: '[Python] 使用 .venv\\Scripts\\python.exe' });
    ok = await runEmbeddingServer(venvPy, [], embeddingDir, res);
  } else if (pyLauncherWorks(embeddingDir)) {
    sseWrite(res, 'log', { line: '[Python] 使用 py -3' });
    ok = await runEmbeddingServer('py', ['-3'], embeddingDir, res);
  } else if (plainPythonWorks(embeddingDir)) {
    sseWrite(res, 'log', { line: '[Python] 使用 python' });
    ok = await runEmbeddingServer('python', [], embeddingDir, res);
  } else {
    sseWrite(res, 'log', { line: '[ERROR] 未找到可用 Python（.venv / py -3 / python）。' });
    sseWrite(res, 'done', {
      ok: false,
      error: '未找到可用 Python，请安装 Python 3 或在 embedding-server 下创建 .venv。'
    });
    return;
  }

  if (ok) {
    sseWrite(res, 'progress', { percent: 100 });
    sseWrite(res, 'done', { ok: true });
  } else {
    sseWrite(res, 'done', {
      ok: false,
      error: '启动超时或进程已退出。请查看上方日志，或手动运行 scripts\\start-embedding.cmd。'
    });
  }
}

async function startMtReferenceFlow(
  projectRoot: string,
  res: ServerResponse,
  startOptions: MtReferenceStartOptions = {}
): Promise<void> {
  const mtDir = path.join(projectRoot, 'scripts', 'translators-server');
  const mainPy = path.join(mtDir, 'main.py');
  if (!fs.existsSync(mainPy)) {
    sseWrite(res, 'log', { line: `[ERROR] 未找到 ${mainPy}` });
    sseWrite(res, 'done', { ok: false, error: '未找到 scripts/translators-server/main.py' });
    return;
  }

  const venvPy = path.join(mtDir, '.venv', 'Scripts', 'python.exe');
  let ok = false;

  const runWithResolved = async (baseExe: string, basePrefix: string[]) => {
    const resolved = ensureVenvPython(baseExe, basePrefix, mtDir, res);
    if (!resolved) return false;
    sseWrite(res, 'log', {
      line: `[Python] 使用 ${resolved.exe === venvPy ? '.venv\\Scripts\\python.exe' : resolved.exe}`,
    });
    return runMtReferenceServer(resolved.exe, resolved.prefix, mtDir, res, startOptions);
  };

  if (fs.existsSync(venvPy)) {
    sseWrite(res, 'log', { line: '[Python] 使用 .venv\\Scripts\\python.exe' });
    ok = await runMtReferenceServer(venvPy, [], mtDir, res, startOptions);
  } else if (pyLauncherWorks(mtDir)) {
    sseWrite(res, 'log', { line: '[Python] 使用 py -3' });
    ok = await runWithResolved('py', ['-3']);
  } else if (plainPythonWorks(mtDir)) {
    sseWrite(res, 'log', { line: '[Python] 使用 python' });
    ok = await runWithResolved('python', []);
  } else {
    sseWrite(res, 'log', { line: '[ERROR] 未找到可用 Python（py -3 / python）。' });
    sseWrite(res, 'done', {
      ok: false,
      error: '未找到可用 Python，请安装 Python 3.10+ 后重试，或手动运行 scripts\\start-mt-reference.cmd。',
    });
    return;
  }

  if (ok) {
    sseWrite(res, 'progress', { percent: 100 });
    sseWrite(res, 'done', { ok: true });
  } else {
    sseWrite(res, 'done', {
      ok: false,
      error: '启动超时或进程已退出。请查看上方日志，或手动运行 scripts\\start-mt-reference.cmd。',
    });
  }
}

async function handleSidecarStartRequest(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  opts: {
    startPath: string;
    batRelative: string;
    missingBatError: string;
    nonWinError: string;
    busyError: string;
    alreadyUp: () => Promise<boolean>;
    getStarting: () => boolean;
    setStarting: (v: boolean) => void;
    parseStartOptions?: (req: IncomingMessage) => Promise<unknown>;
    runFlow: (res: ServerResponse, startOptions?: unknown) => Promise<void>;
  }
): Promise<boolean> {
  if (req.method !== 'POST' || req.url !== opts.startPath) {
    return false;
  }

  const bat = path.join(root, opts.batRelative);
  if (!fs.existsSync(bat)) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: opts.missingBatError }));
    return true;
  }

  if (process.platform !== 'win32') {
    res.statusCode = 501;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: opts.nonWinError }));
    return true;
  }

  if (opts.getStarting()) {
    res.statusCode = 409;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: opts.busyError }));
    return true;
  }

  try {
    if (await opts.alreadyUp()) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, alreadyRunning: true }));
      return true;
    }
  } catch {
    /* ignore */
  }

  opts.setStarting(true);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let startOptions: unknown;
  try {
    startOptions = opts.parseStartOptions ? await opts.parseStartOptions(req) : undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sseWrite(res, 'log', { line: `[ERROR] 无法读取启动参数：${msg}` });
    sseWrite(res, 'done', { ok: false, error: msg });
    opts.setStarting(false);
    res.end();
    return true;
  }

  try {
    await opts.runFlow(res, startOptions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sseWrite(res, 'log', { line: `[ERROR] ${msg}` });
    sseWrite(res, 'done', { ok: false, error: msg });
  } finally {
    opts.setStarting(false);
    if (!res.writableEnded) {
      res.end();
    }
  }
  return true;
}

export function smartCatDevServerPlugin(root: string): Plugin {
  return {
    name: 'smartcat-dev-sidecars',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (
          await handleSidecarStartRequest(req, res, root, {
            startPath: EMBED_START_PATH,
            batRelative: 'scripts/start-embedding.cmd',
            missingBatError: '未找到 scripts/start-embedding.cmd',
            nonWinError: '当前仅支持在 Windows 下由界面自动启动；请在终端手动运行 embedding 服务。',
            busyError: '向量服务正在启动中，请稍候再试。',
            alreadyUp: embeddingAlreadyUp,
            getStarting: () => embedStarting,
            setStarting: (v) => {
              embedStarting = v;
            },
            runFlow: (r) => startEmbeddingFlow(root, r),
          })
        ) {
          return;
        }

        if (
          await handleSidecarStartRequest(req, res, root, {
            startPath: MT_REF_START_PATH,
            batRelative: 'scripts/start-mt-reference.cmd',
            missingBatError: '未找到 scripts/start-mt-reference.cmd',
            nonWinError: '当前仅支持在 Windows 下由界面自动启动；请在终端手动运行 MT 参考服务。',
            busyError: 'MT 参考服务正在启动中，请稍候再试。',
            alreadyUp: mtReferenceAlreadyUp,
            getStarting: () => mtRefStarting,
            setStarting: (v) => {
              mtRefStarting = v;
            },
            parseStartOptions: readJsonBody,
            runFlow: (r, raw) =>
              startMtReferenceFlow(root, r, (raw ?? {}) as MtReferenceStartOptions),
          })
        ) {
          return;
        }

        next();
      });
    },
  };
}
