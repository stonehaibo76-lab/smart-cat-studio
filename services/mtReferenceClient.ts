import { getApiBaseUrl } from './authService';
import { DEFAULT_MT_REFERENCE_SERVICE_URL, mtTranslatorLabel } from '../constants';
import type { MtReferenceSettings } from '../types';

const HEALTH_TIMEOUT_MS = 15_000;
const TRANSLATE_TIMEOUT_MS = 35_000;
const MAX_QUERY_LEN = 20000;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

export type MtReferenceHealthResult = {
  ok: boolean;
  translatorsVersion?: string;
  error?: string;
};

export type MtReferenceTranslateResult = {
  ok: boolean;
  text?: string;
  translator?: string;
  elapsedMs?: number;
  error?: string;
};

export type MtCompareResultItem = {
  translatorId: string;
  label: string;
  status: 'loading' | 'ok' | 'error';
  text?: string;
  error?: string;
  elapsedMs?: number;
};

/** Smart-CAT 语言码 → translators 参数 */
export function mapLangForTranslators(code: string, role: 'from' | 'to'): string {
  const c = (code || '').trim().toLowerCase();
  if (!c) return role === 'from' ? 'auto' : 'en';
  if (c.startsWith('zh')) return 'zh';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('ja')) return 'ja';
  if (c.startsWith('ko')) return 'ko';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('de')) return 'de';
  if (c.startsWith('es')) return 'es';
  if (c.startsWith('ru')) return 'ru';
  if (c.startsWith('uk')) return 'uk';
  if (c.startsWith('it')) return 'it';
  if (c.startsWith('pt')) return 'pt';
  if (c.startsWith('vi')) return 'vi';
  if (c.startsWith('th')) return 'th';
  if (role === 'from') return 'auto';
  return c.split('-')[0];
}

export function resolveMtReferenceServiceUrl(settings?: MtReferenceSettings): string {
  return normalizeBaseUrl(settings?.serviceUrl?.trim() || DEFAULT_MT_REFERENCE_SERVICE_URL);
}

/** 句段是否含 XLIFF/占位符标记（参考译文可能不完整） */
export function segmentMayHaveInlineTags(text: string): boolean {
  return /<[^>]+>|\{\d+\}/.test(text);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function sidecarAuthHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = {};
  if (apiKey?.trim()) headers['X-API-Key'] = apiKey.trim();
  return headers;
}

async function readJsonBody<T>(res: Response): Promise<{ data?: T; parseError?: string }> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return { data: undefined };
  if (trimmed.startsWith('<') || trimmed.startsWith('<!DOCTYPE')) {
    return {
      parseError:
        res.status === 404
          ? '本地后端未找到 MT 参考接口（404）。请重启 npm run server 或使用 npm run dev:with-db 启动最新后端。'
          : '服务器返回了网页而非 JSON。请确认 VITE_API_BASE_URL 指向本地后端（默认 http://127.0.0.1:58741），并已运行 npm run dev:with-db。',
    };
  }
  try {
    return { data: JSON.parse(trimmed) as T };
  } catch {
    return { parseError: `响应不是有效 JSON（HTTP ${res.status}）` };
  }
}

function networkErrorHint(msg: string): string {
  if (/fetch|network|abort|failed/i.test(msg)) {
    return '无法连接 Smart-CAT 本地后端，请确认已运行 npm run dev:with-db 或 npm run server';
  }
  return msg;
}

/** 直连 sidecar /health（与向量服务测试方式一致） */
export async function checkMtSidecarDirect(
  settings?: MtReferenceSettings
): Promise<MtReferenceHealthResult> {
  const root = resolveMtReferenceServiceUrl(settings);
  try {
    const res = await fetchWithTimeout(
      `${root}/health`,
      { method: 'GET', headers: sidecarAuthHeaders(settings?.apiKey) },
      HEALTH_TIMEOUT_MS
    );
    const { data, parseError } = await readJsonBody<{
      ok?: boolean;
      translators_version?: string;
      translatorsVersion?: string;
    }>(res);
    if (parseError) return { ok: false, error: parseError };
    if (!res.ok || !data?.ok) {
      return { ok: false, error: `sidecar HTTP ${res.status}` };
    }
    return {
      ok: true,
      translatorsVersion: data.translators_version || data.translatorsVersion,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch|network|abort/i.test(msg)) {
      return {
        ok: false,
        error: `无法连接 translators sidecar（${root}）。请先运行 scripts/start-mt-reference.cmd 或手动启动 uvicorn。`,
      };
    }
    return { ok: false, error: msg };
  }
}

export async function checkMtReferenceHealth(
  settings?: MtReferenceSettings
): Promise<MtReferenceHealthResult> {
  const apiBase = getApiBaseUrl();
  const upstream = resolveMtReferenceServiceUrl(settings);
  const params = new URLSearchParams({ upstream });
  if (settings?.apiKey?.trim()) params.set('apiKey', settings.apiKey.trim());

  try {
    const res = await fetchWithTimeout(
      `${apiBase}/api/mt-reference/health?${params.toString()}`,
      { method: 'GET' },
      HEALTH_TIMEOUT_MS
    );
    const { data, parseError } = await readJsonBody<{
      ok?: boolean;
      translatorsVersion?: string;
      error?: string;
    }>(res);
    if (parseError) {
      if (res.status === 404) {
        const sidecar = await checkMtSidecarDirect(settings);
        if (sidecar.ok) {
          return {
            ok: false,
            error:
              'translators sidecar 已就绪，但本地 Node 后端缺少 /api/mt-reference 接口。请停止旧后端进程并重新运行 npm run server 或 npm run dev:with-db。',
          };
        }
      }
      return { ok: false, error: parseError };
    }
    if (!res.ok || !data?.ok) {
      const sidecarErr = data?.error;
      if (sidecarErr) {
        return {
          ok: false,
          error: `${sidecarErr}。请确认已启动 sidecar：scripts/start-mt-reference.cmd（默认 ${upstream}）`,
        };
      }
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true, translatorsVersion: data.translatorsVersion };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: networkErrorHint(msg) };
  }
}

export async function fetchMtReference(
  text: string,
  translator: string,
  fromLang: string,
  toLang: string,
  settings?: MtReferenceSettings
): Promise<MtReferenceTranslateResult> {
  const q = text.trim();
  if (!q) return { ok: false, error: '查询文本为空' };
  if (q.length > MAX_QUERY_LEN) {
    return { ok: false, error: `文本超过 ${MAX_QUERY_LEN} 字符上限` };
  }

  const apiBase = getApiBaseUrl();
  const upstreamBaseUrl = resolveMtReferenceServiceUrl(settings);
  const from = mapLangForTranslators(fromLang, 'from');
  const to = mapLangForTranslators(toLang, 'to');

  try {
    const res = await fetchWithTimeout(
      `${apiBase}/api/mt-reference/translate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upstreamBaseUrl,
          apiKey: settings?.apiKey?.trim() || undefined,
          text: q,
          translator: translator.trim() || 'bing',
          from_language: from,
          to_language: to,
        }),
      },
      TRANSLATE_TIMEOUT_MS
    );
    const { data, parseError } = await readJsonBody<{
      ok?: boolean;
      text?: string;
      translator?: string;
      elapsed_ms?: number;
      error?: string;
    }>(res);
    if (parseError) {
      return { ok: false, error: parseError };
    }
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      text: data.text,
      translator: data.translator,
      elapsedMs: data.elapsed_ms,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: networkErrorHint(msg) };
  }
}

/** 并行查询多个 MT 引擎，供对比面板使用 */
export async function fetchMtReferenceCompare(
  text: string,
  translatorIds: string[],
  fromLang: string,
  toLang: string,
  settings?: MtReferenceSettings
): Promise<MtCompareResultItem[]> {
  const ids = [...new Set(translatorIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  return Promise.all(
    ids.map(async (translatorId): Promise<MtCompareResultItem> => {
      const label = mtTranslatorLabel(translatorId);
      const r = await fetchMtReference(text, translatorId, fromLang, toLang, settings);
      if (r.ok) {
        return {
          translatorId,
          label,
          status: 'ok',
          text: r.text ?? '',
          elapsedMs: r.elapsedMs,
        };
      }
      return {
        translatorId,
        label,
        status: 'error',
        error: r.error ?? '查询失败',
        elapsedMs: r.elapsedMs,
      };
    })
  );
}
