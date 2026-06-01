import { withAiConcurrency } from './aiConcurrency';

const DEFAULT_TIMEOUT_MS = 120_000;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

export type EmbeddingHealthResult = {
  ok: boolean;
  model?: string;
  dimension?: number;
  error?: string;
};

export type EmbedResponse = {
  model: string;
  dimension: number;
  vectors: number[][];
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function checkEmbeddingHealth(
  baseUrl: string,
  apiKey?: string
): Promise<EmbeddingHealthResult> {
  const root = normalizeBaseUrl(baseUrl.trim() || 'http://127.0.0.1:8765');
  try {
    const headers: HeadersInit = {};
    if (apiKey) headers['X-API-Key'] = apiKey;
    const res = await fetchWithTimeout(`${root}/health`, { headers, method: 'GET' }, 15_000);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean; model?: string; dimension?: number };
    return {
      ok: !!data.ok,
      model: data.model,
      dimension: data.dimension,
      error: data.ok ? undefined : '服务未就绪'
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function embedTexts(
  baseUrl: string,
  texts: string[],
  apiKey?: string,
  batchSize: number = 48
): Promise<EmbedResponse> {
  return withAiConcurrency(async () => embedTextsInner(baseUrl, texts, apiKey, batchSize));
}

async function embedTextsInner(
  baseUrl: string,
  texts: string[],
  apiKey?: string,
  batchSize: number = 48
): Promise<EmbedResponse> {
  const root = normalizeBaseUrl(baseUrl.trim() || 'http://127.0.0.1:8765');
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };
  if (apiKey) headers['X-API-Key'] = apiKey;

  const allVectors: number[][] = [];
  let model = '';
  let dimension = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetchWithTimeout(
      `${root}/embed`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs: batch })
      },
      DEFAULT_TIMEOUT_MS
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Embedding HTTP ${res.status}: ${t || res.statusText}`);
    }
    const data = (await res.json()) as EmbedResponse;
    if (!data.vectors?.length) {
      throw new Error('Embedding 响应无 vectors');
    }
    model = data.model;
    dimension = data.dimension;
    allVectors.push(...data.vectors);
  }

  return { model, dimension, vectors: allVectors };
}

