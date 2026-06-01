import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const START_PATH = '/__smartcat/start-embedding';

let embedStarting = false;

async function embeddingAlreadyUp(): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
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

function checkImport(exe: string, prefix: string[], cwd: string): boolean {
  const r = spawnSync(exe, [...prefix, '-c', 'import sentence_transformers'], {
    cwd,
    windowsHide: true,
    stdio: 'ignore'
  });
  return r.status === 0;
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

async function waitForUvicornHealthy(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  while (Date.now() - start < timeoutMs) {
    if (await embeddingAlreadyUp()) {
      return true;
    }
    if (exited) {
      await new Promise((r) => setTimeout(r, 500));
      return embeddingAlreadyUp();
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return embeddingAlreadyUp();
}

async function runEmbeddingServer(
  exe: string,
  prefix: string[],
  cwd: string,
  res: ServerResponse
): Promise<boolean> {
  if (!checkImport(exe, prefix, cwd)) {
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

  return waitForUvicornHealthy(child, 12 * 60 * 1000);
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

/**
 * 开发服务器插件：POST /__smartcat/start-embedding
 * - 若 8765 已在服务：返回 JSON { ok, alreadyRunning }
 * - 否则以 SSE 流式输出日志与进度，后台启动 uvicorn（不另开控制台窗口）
 */
export function smartCatDevServerPlugin(projectRoot: string): Plugin {
  return {
    name: 'smartcat-dev-embedding',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== 'POST' || req.url !== START_PATH) {
          next();
          return;
        }

        const bat = path.join(projectRoot, 'scripts', 'start-embedding.cmd');
        if (!fs.existsSync(bat)) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: '未找到 scripts/start-embedding.cmd' }));
          return;
        }

        if (process.platform !== 'win32') {
          res.statusCode = 501;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              ok: false,
              error: '当前仅支持在 Windows 下由界面自动启动；请在终端手动运行 embedding 服务。'
            })
          );
          return;
        }

        if (embedStarting) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: '向量服务正在启动中，请稍候再试。' }));
          return;
        }

        try {
          if (await embeddingAlreadyUp()) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, alreadyRunning: true }));
            return;
          }
        } catch {
          /* ignore */
        }

        embedStarting = true;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });

        try {
          await startEmbeddingFlow(projectRoot, res);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sseWrite(res, 'log', { line: `[ERROR] ${msg}` });
          sseWrite(res, 'done', { ok: false, error: msg });
        } finally {
          embedStarting = false;
          if (!res.writableEnded) {
            res.end();
          }
        }
      });
    }
  };
}
