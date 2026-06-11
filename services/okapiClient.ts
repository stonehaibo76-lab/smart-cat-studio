import { getApiBaseUrl, authHeaders } from './authService';
import type { OkapiSettings } from '../types';
import type { MonolingualExportFont } from './catInterop/originalFormatExportTypes';

const DEFAULT_OKAPI_URL = 'http://127.0.0.1:8090';

export type OkapiHealthResult = {
  ok: boolean;
  version?: string;
  error?: string;
  mergeSupported?: boolean;
};

export type OkapiExtractResult = {
  ok: boolean;
  segments?: OkapiExtractSegment[];
  error?: string;
};

export type OkapiExtractSegment = {
  id: string;
  source: string;
  target?: string;
  okapiTuId?: string;
  inlineRunMeta?: import('../types').InlineRunStyle[];
};

export function resolveOkapiServiceUrl(settings?: OkapiSettings): string {
  return (settings?.serviceUrl?.trim() || DEFAULT_OKAPI_URL).replace(/\/+$/, '');
}

function decodeHeaderFileName(res: Response, fallback: string): string {
  const b64 =
    res.headers.get('x-smartcat-file-name-b64') ||
    res.headers.get('X-Smartcat-File-Name-B64');
  if (b64) {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch {
      /* fall through */
    }
  }
  return (
    res.headers.get('x-smartcat-file-name') ||
    res.headers.get('X-Smartcat-File-Name') ||
    fallback
  );
}

async function readJsonBody<T>(res: Response): Promise<{ data?: T; parseError?: string }> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return { data: undefined };
  if (trimmed.startsWith('<') || trimmed.startsWith('<!DOCTYPE')) {
    return {
      parseError:
        res.status === 404
          ? '本地后端未找到 /api/okapi/merge（404）。请关闭 SmartCAT-DB 窗口后重新运行启动脚本，或执行 npm run server。'
          : '服务器返回了网页而非 JSON。请确认本地 DB 服务（58741）与 Okapi 侧车（8090）均已启动。',
    };
  }
  try {
    return { data: JSON.parse(trimmed) as T };
  } catch {
    return { parseError: `响应不是有效 JSON（HTTP ${res.status}）` };
  }
}

function buildMergePayload(segments: OkapiMergeSegment[]) {
  return segments.map((seg, index) => ({
    okapiTuId: seg.okapiTuId ?? `p-${index}`,
    id: seg.id,
    source: seg.source,
    target: seg.target,
  }));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function mergeViaServer(
  fileName: string,
  originalBytes: ArrayBuffer,
  segments: OkapiMergeSegment[],
  settings?: OkapiSettings,
  exportFont?: MonolingualExportFont
): Promise<{ fileName: string; bytes: Uint8Array; mime: string } | null> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/okapi/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      fileName,
      fileBase64: arrayBufferToBase64(originalBytes),
      segments: buildMergePayload(segments),
      serviceUrl: settings?.serviceUrl,
      exportFont: exportFont ?? 'simsun',
    }),
    signal: AbortSignal.timeout(300_000),
  });

  const { data, parseError } = await readJsonBody<OkapiMergeResult>(res);
  if (parseError) {
    if (res.status === 404) return null;
    throw new Error(parseError);
  }
  if (!res.ok || !data?.ok || !data.fileBase64) {
    if (res.status === 404) return null;
    throw new Error(data?.error || res.statusText || 'merge failed');
  }
  const raw = atob(data.fileBase64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return {
    fileName: data.fileName || fileName,
    bytes: out,
    mime: data.mime || 'application/octet-stream',
  };
}

async function mergeViaSidecarDirect(
  fileName: string,
  originalBytes: ArrayBuffer,
  segments: OkapiMergeSegment[],
  settings?: OkapiSettings,
  exportFont?: MonolingualExportFont
): Promise<{ fileName: string; bytes: Uint8Array; mime: string }> {
  const root = resolveOkapiServiceUrl(settings);
  const form = new FormData();
  form.append('file', new Blob([originalBytes]), fileName);
  form.append('segments_json', JSON.stringify(buildMergePayload(segments)));
  form.append('export_font', exportFont ?? 'simsun');

  const res = await fetch(`${root}/merge`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const { data, parseError } = await readJsonBody<{ error?: string; detail?: string }>(res);
    throw new Error(
      data?.error || data?.detail || parseError || `Okapi 侧车 merge 失败（HTTP ${res.status}）`
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const outName = decodeHeaderFileName(
    res,
    `${fileName.replace(/\.[^.]+$/, '')}_译文${fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.docx'}`
  );
  return {
    fileName: outName,
    bytes,
    mime: res.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function checkOkapiHealth(settings?: OkapiSettings): Promise<OkapiHealthResult> {
  try {
    const base = getApiBaseUrl();
    const url = settings?.serviceUrl?.trim()
      ? `${base}/api/okapi/health?serviceUrl=${encodeURIComponent(resolveOkapiServiceUrl(settings))}`
      : `${base}/api/okapi/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const { data, parseError } = await readJsonBody<OkapiHealthResult & { error?: string }>(res);
    if (parseError || !data) {
      return { ok: false, error: parseError || res.statusText };
    }
    return { ok: Boolean(data.ok), version: data.version, error: data.error, mergeSupported: data.mergeSupported };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

export async function okapiExtractFile(
  file: File,
  settings?: OkapiSettings
): Promise<OkapiExtractResult> {
  const base = getApiBaseUrl();
  const arrayBuffer = await file.arrayBuffer();
  const res = await fetch(`${base}/api/okapi/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      fileName: file.name,
      fileBase64: arrayBufferToBase64(arrayBuffer),
      serviceUrl: settings?.serviceUrl,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const { data, parseError } = await readJsonBody<OkapiExtractResult>(res);
  if (parseError) return { ok: false, error: parseError };
  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText };
  }
  return data ?? { ok: false, error: 'empty response' };
}

export type OkapiMergeResult = {
  ok: boolean;
  fileName?: string;
  fileBase64?: string;
  mime?: string;
  error?: string;
};

export type OkapiMergeSegment = {
  okapiTuId?: string;
  id?: string;
  source?: string;
  target?: string;
};

export async function okapiMergeFile(
  fileName: string,
  originalBytes: ArrayBuffer,
  segments: OkapiMergeSegment[],
  settings?: OkapiSettings,
  exportFont?: MonolingualExportFont
): Promise<{ fileName: string; bytes: Uint8Array; mime: string }> {
  try {
    const viaServer = await mergeViaServer(fileName, originalBytes, segments, settings, exportFont);
    if (viaServer) return viaServer;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/404|not found/i.test(msg)) throw e;
  }

  try {
    return await mergeViaSidecarDirect(fileName, originalBytes, segments, settings, exportFont);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/failed to fetch|network|abort/i.test(msg)) {
      throw new Error(
        '无法连接 Okapi 侧车（8090）。请确认 SmartCAT-Okapi 窗口正在运行，并重启侧车以加载 merge 接口。'
      );
    }
    throw e;
  }
}

export const OKAPI_SUPPORTED_EXTENSIONS = [
  '.docx',
  '.html',
  '.htm',
  '.idml',
  '.xlf',
  '.xliff',
  '.mqxliff',
  '.sdlxliff',
  '.txt',
  '.json',
];

export function isOkapiCandidateFile(name: string): boolean {
  const lower = name.toLowerCase();
  return OKAPI_SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
