import { getApiBaseUrl } from './authService';
import { DEFAULT_LOCAL_LLM_BASE_URL } from '../constants';
import type { AISettings } from '../types';

const CHAT_TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 15_000;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

/** 确保 OpenAI 兼容根地址以 /v1 结尾 */
export function resolveLocalLlmBaseUrl(settings?: AISettings): string {
  let url = normalizeBaseUrl(settings?.localLlmBaseUrl?.trim() || DEFAULT_LOCAL_LLM_BASE_URL);
  if (!/\/v1$/i.test(url)) {
    url = `${url}/v1`;
  }
  return url;
}

export type OpenAIChatPayload = {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  chat_template_kwargs?: { enable_thinking?: boolean };
};

const DEFAULT_LOCAL_CHAT_TEMPLATE_KWARGS = { enable_thinking: false } as const;

function extractAssistantContent(message: {
  content?: unknown;
  reasoning_content?: unknown;
}): string {
  if (typeof message.content === 'string') {
    const stripped = message.content.replace(/[\s\S]*?<\/think>/gi, '').trim();
    if (stripped) return stripped;
  }
  // 思考模式未关闭时，模型可能只填充 reasoning_content；不应作为译文，但便于报错提示
  if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    throw new Error(
      '本地模型处于思考（Thinking）模式且未返回译文。请在 llama-server 启动参数中加入 --jinja --reasoning-budget 0，或更新 Smart-CAT 后重试。'
    );
  }
  return '';
}

export type LocalLlmHealthResult = {
  ok: boolean;
  error?: string;
};

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

export async function checkLocalLlmHealth(
  upstreamBaseUrl: string,
  apiKey?: string
): Promise<LocalLlmHealthResult> {
  const apiBase = getApiBaseUrl();
  const upstream = normalizeBaseUrl(upstreamBaseUrl || DEFAULT_LOCAL_LLM_BASE_URL);
  const params = new URLSearchParams({ upstream });
  if (apiKey?.trim()) params.set('apiKey', apiKey.trim());

  try {
    const res = await fetchWithTimeout(
      `${apiBase}/api/local-llm/health?${params.toString()}`,
      { method: 'GET' },
      HEALTH_TIMEOUT_MS
    );
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: !!data.ok, error: data.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch|network|abort/i.test(msg)) {
      return {
        ok: false,
        error: '无法连接 Smart-CAT 本地后端，请确认已运行 npm run dev:with-db 或 npm run server',
      };
    }
    return { ok: false, error: msg };
  }
}

export async function localLlmChatCompletions(
  settings: AISettings,
  payload: OpenAIChatPayload
): Promise<string> {
  const apiBase = getApiBaseUrl();
  const upstreamBaseUrl = resolveLocalLlmBaseUrl(settings);
  const apiKey = settings.localLlmApiKey?.trim() || undefined;

  const requestBody = {
    upstreamBaseUrl,
    apiKey,
    chat_template_kwargs: {
      ...DEFAULT_LOCAL_CHAT_TEMPLATE_KWARGS,
      ...payload.chat_template_kwargs,
    },
    ...payload,
  };

  const res = await fetchWithTimeout(
    `${apiBase}/api/local-llm/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
    CHAT_TIMEOUT_MS
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`本地 LLM 代理错误: ${res.status} - ${err}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[];
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const message = data?.choices?.[0]?.message;
  if (!message) {
    throw new Error('本地 LLM 返回格式异常：缺少 message');
  }

  const content = extractAssistantContent(message);
  if (!content) {
    throw new Error('本地 LLM 返回空译文，请检查模型是否处于思考模式或调大 max_tokens');
  }
  return content;
}
