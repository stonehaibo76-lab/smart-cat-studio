/** 仅在 Vite 开发服务器下可用：由 Node 后台启动 embedding（SSE 日志） */
const START_PATH = '/__smartcat/start-embedding';

export type DevEmbeddingStartResult =
  | { ok: true; alreadyRunning?: boolean }
  | { ok: false; error: string };

export type DevEmbeddingStreamHandlers = {
  onLogLine?: (line: string) => void;
  /** null 表示尚无百分比（如 pip 输出不含 %） */
  onProgress?: (percent: number | null) => void;
};

function parseSseBlocks(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    const lines = block.split('\n').filter(Boolean);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }
  return { events, rest };
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: DevEmbeddingStreamHandlers
): Promise<DevEmbeddingStartResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result: DevEmbeddingStartResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parsed = parseSseBlocks(buf);
    buf = parsed.rest;
    for (const ev of parsed.events) {
      if (ev.event === 'log') {
        try {
          const j = JSON.parse(ev.data) as { line?: string };
          if (j.line != null) handlers.onLogLine?.(j.line);
        } catch {
          handlers.onLogLine?.(ev.data);
        }
      } else if (ev.event === 'progress') {
        try {
          const j = JSON.parse(ev.data) as { percent?: number };
          if (typeof j.percent === 'number') handlers.onProgress?.(j.percent);
        } catch {
          handlers.onProgress?.(null);
        }
      } else if (ev.event === 'done') {
        try {
          const j = JSON.parse(ev.data) as { ok?: boolean; alreadyRunning?: boolean; error?: string };
          if (j.ok === true) {
            result = { ok: true, alreadyRunning: j.alreadyRunning === true };
          } else {
            result = { ok: false, error: j.error || '启动失败' };
          }
        } catch {
          result = { ok: false, error: ev.data || '启动失败' };
        }
      }
    }
  }

  const tail = parseSseBlocks(buf + '\n\n');
  for (const ev of tail.events) {
    if (ev.event === 'done') {
      try {
        const j = JSON.parse(ev.data) as { ok?: boolean; alreadyRunning?: boolean; error?: string };
        if (j.ok === true) result = { ok: true, alreadyRunning: j.alreadyRunning === true };
        else result = { ok: false, error: j.error || '启动失败' };
      } catch {
        result = { ok: false, error: ev.data };
      }
    }
  }

  return result ?? { ok: false, error: '未收到完成事件，连接可能已中断。' };
}

/**
 * 请求启动本地向量服务。
 * - 若服务已在运行：返回 JSON，无流式日志。
 * - 否则：消费 SSE，触发 onLogLine / onProgress，直至 done。
 */
export async function requestStartLocalEmbeddingService(
  handlers: DevEmbeddingStreamHandlers = {}
): Promise<DevEmbeddingStartResult> {
  try {
    const r = await fetch(`${window.location.origin}${START_PATH}`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream, application/json' }
    });

    if (r.status === 409) {
      let msg = '向量服务正在启动中';
      try {
        const j = (await r.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg };
    }

    const ct = r.headers.get('Content-Type') || '';

    if (ct.includes('application/json')) {
      let data: { ok?: boolean; alreadyRunning?: boolean; error?: string } = {};
      try {
        data = (await r.json()) as typeof data;
      } catch {
        return {
          ok: false,
          error:
            r.status === 404
              ? '当前不是开发模式（无 Vite 代理）。请手动双击运行项目里的 scripts\\start-embedding.cmd'
              : `HTTP ${r.status}`
        };
      }
      if (!r.ok || data.ok === false) {
        return { ok: false, error: data.error || `HTTP ${r.status}` };
      }
      return { ok: true, alreadyRunning: data.alreadyRunning === true };
    }

    if (!r.ok || !r.body) {
      return { ok: false, error: `HTTP ${r.status}` };
    }

    handlers.onProgress?.(null);
    return readSseStream(r.body, handlers);
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : '无法连接开发服务器，请确认使用 npm run dev 启动，或手动运行 scripts\\start-embedding.cmd'
    };
  }
}
