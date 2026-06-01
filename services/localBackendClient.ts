import type { Project, TermBase, TranslationMemory, TwinTranslatorProfile, KnowledgeBase, GrammarRuleBook, RegexDictionaryBook } from '../types';
import { MOCK_PROJECTS, MOCK_TBS, MOCK_TMS } from '../constants';
import { authHeaders, clearAuthSession, getApiBaseUrl, isAuthRequired } from './authService';

const BASE = getApiBaseUrl();

/** JSON / load-all / 集合保存（本地库可能较大） */
const DEFAULT_FETCH_JSON_TIMEOUT_MS = 300_000;
/** 切换数据库路径 */
const DATA_STORE_POST_TIMEOUT_MS = 60_000;
/** 导入整库二进制 */
const IMPORT_DATABASE_TIMEOUT_MS = 600_000;
/** 导出数据库下载 */
const EXPORT_DATABASE_TIMEOUT_MS = 600_000;
/** 读取单条 settings */
const LOAD_SETTING_TIMEOUT_MS = 30_000;

function handleUnauthorized(res: Response): void {
  if (res.status === 401 && isAuthRequired()) {
    clearAuthSession();
    window.location.reload();
  }
}

async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs: number = DEFAULT_FETCH_JSON_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('Local API 请求超时', 'AbortError')),
    timeoutMs
  );
  const outer = init?.signal;
  const onOuterAbort = () => ctrl.abort(outer?.reason ?? new DOMException('Aborted', 'AbortError'));
  if (outer) {
    if (outer.aborted) {
      clearTimeout(t);
      throw outer.reason;
    }
    outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const text = await res.text().catch(() => '');
      throw new Error(`Local API ${path} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(t);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** 从 settings_kv 读取单条；无记录或失败时返回 null（不抛错） */
export async function loadSetting(key: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('loadSetting 超时', 'AbortError')),
    LOAD_SETTING_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${BASE}/api/settings/${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json', ...authHeaders() },
      signal: ctrl.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      handleUnauthorized(res);
      const text = await res.text().catch(() => '');
      console.warn(`[SmartCAT] loadSetting ${key}: ${res.status} ${text}`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type LocalBackendHealth = {
  ok: boolean;
  dbPath: string;
  configPath: string;
  envLocked: boolean;
  resolvedFrom: string;
  dbFileBytes: number | null;
  walFileBytes: number | null;
  cloudMode?: boolean;
};

export async function fetchLocalBackendHealth(timeoutMs = 1200): Promise<LocalBackendHealth | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as LocalBackendHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function pingLocalBackend(timeoutMs = 1200): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function loadAllData(opts?: { omitHeavyCollections?: boolean }) {
  const q = opts?.omitHeavyCollections ? '?omit=twins,knowledge' : '';
  const raw = await fetchJson<{
    initialized: boolean;
    projects: Project[];
    termBases: TermBase[];
    translationMemories: TranslationMemory[];
    twinTranslators: TwinTranslatorProfile[];
    knowledgeBases: KnowledgeBase[];
    grammarRuleBooks: GrammarRuleBook[];
    regexDictionaryBooks: RegexDictionaryBook[];
    aiSettings: unknown;
    editorSettings: unknown;
    quickPrompts: unknown;
    favoriteUrls?: unknown;
    customOnlineDictionaries?: unknown;
    embeddingSettings: unknown;
    welcomeCompleted?: boolean;
    skipStartupScreen?: boolean;
  }>(`/api/load-all${q}`);

  let resolvedFavoriteUrls: unknown = raw.favoriteUrls;
  if (resolvedFavoriteUrls === undefined) {
    resolvedFavoriteUrls = await loadSetting('favorite-urls');
  }

  let resolvedCustomOnlineDictionaries: unknown = raw.customOnlineDictionaries;
  if (resolvedCustomOnlineDictionaries === undefined) {
    resolvedCustomOnlineDictionaries = await loadSetting('custom-online-dictionaries');
  }

  if (!raw.initialized) {
    await Promise.all([
      saveProjects(MOCK_PROJECTS),
      saveTermBases(MOCK_TBS),
      saveTMs(MOCK_TMS),
      saveGrammarRuleBooks([]),
      saveRegexDictionaryBooks([]),
      saveSettings('db-initialized', true),
    ]);
    return {
      projects: MOCK_PROJECTS,
      termBases: MOCK_TBS,
      translationMemories: MOCK_TMS,
      twinTranslators: raw.twinTranslators ?? [],
      knowledgeBases: raw.knowledgeBases ?? [],
      grammarRuleBooks: raw.grammarRuleBooks ?? [],
      regexDictionaryBooks: raw.regexDictionaryBooks ?? [],
      aiSettings: raw.aiSettings || { provider: 'gemini', model: 'gemini-3-flash-preview' },
      editorSettings: raw.editorSettings ?? null,
      quickPrompts: raw.quickPrompts ?? null,
      favoriteUrls: resolvedFavoriteUrls ?? null,
      customOnlineDictionaries: resolvedCustomOnlineDictionaries ?? null,
      embeddingSettings: raw.embeddingSettings ?? null,
      welcomeCompleted: raw.welcomeCompleted === true,
      skipStartupScreen: raw.skipStartupScreen === true,
    };
  }

  return {
    projects: raw.projects,
    termBases: raw.termBases,
    translationMemories: raw.translationMemories,
    twinTranslators: raw.twinTranslators ?? [],
    knowledgeBases: raw.knowledgeBases ?? [],
    grammarRuleBooks: raw.grammarRuleBooks ?? [],
    regexDictionaryBooks: raw.regexDictionaryBooks ?? [],
    aiSettings: raw.aiSettings || { provider: 'gemini', model: 'gemini-3-flash-preview' },
    editorSettings: raw.editorSettings ?? null,
    quickPrompts: raw.quickPrompts ?? null,
    favoriteUrls: resolvedFavoriteUrls ?? null,
    customOnlineDictionaries: resolvedCustomOnlineDictionaries ?? null,
    embeddingSettings: raw.embeddingSettings ?? null,
    welcomeCompleted: raw.welcomeCompleted === true,
    skipStartupScreen: raw.skipStartupScreen === true,
  };
}

export async function saveProjects(projects: Project[]) {
  await fetchJson('/api/projects', { method: 'PUT', body: JSON.stringify(projects) });
}

export async function saveTermBases(tbs: TermBase[]) {
  await fetchJson('/api/term-bases', { method: 'PUT', body: JSON.stringify(tbs) });
}

export async function saveTMs(tms: TranslationMemory[]) {
  await fetchJson('/api/translation-memories', { method: 'PUT', body: JSON.stringify(tms) });
}

export async function saveTwinTranslators(twinTranslators: TwinTranslatorProfile[]) {
  await fetchJson('/api/twin-translators', { method: 'PUT', body: JSON.stringify(twinTranslators) });
}

export async function fetchTwinTranslators(): Promise<TwinTranslatorProfile[]> {
  return fetchJson<TwinTranslatorProfile[]>('/api/twin-translators');
}

export async function saveKnowledgeBases(list: KnowledgeBase[]) {
  await fetchJson('/api/knowledge-bases', { method: 'PUT', body: JSON.stringify(list) });
}

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  return fetchJson<KnowledgeBase[]>('/api/knowledge-bases');
}

export async function saveGrammarRuleBooks(list: GrammarRuleBook[]) {
  await fetchJson('/api/grammar-rule-books', { method: 'PUT', body: JSON.stringify(list) });
}

export async function saveRegexDictionaryBooks(list: RegexDictionaryBook[]) {
  await fetchJson('/api/regex-dictionary-books', { method: 'PUT', body: JSON.stringify(list) });
}

export async function saveSettings(key: string, value: unknown) {
  await fetchJson(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(value),
  });
}

export type LocalDataStoreInfo = {
  dbPath: string;
  configPath: string;
  envLocked: boolean;
  resolvedFrom: string;
};

export async function fetchLocalDataStore(): Promise<LocalDataStoreInfo> {
  return fetchJson<LocalDataStoreInfo>('/api/data-store');
}

function throwApiFailure(path: string, res: Response, text: string): never {
  try {
    const j = JSON.parse(text) as { error?: unknown };
    if (typeof j?.error === 'string') throw new Error(j.error);
  } catch (e) {
    if (e instanceof SyntaxError) {
      /* fall through */
    } else if (e instanceof Error) {
      throw e;
    }
  }
  throw new Error((text || '').trim() || `${path} 请求失败 (${res.status})`);
}

export async function applyLocalDataStorePath(databaseFile: string): Promise<LocalDataStoreInfo & { ok: true }> {
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('切换数据库路径请求超时', 'AbortError')),
    DATA_STORE_POST_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${BASE}/api/data-store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ databaseFile }),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throwApiFailure('/api/data-store', res, text);
    return JSON.parse(text) as LocalDataStoreInfo & { ok: true };
  } finally {
    clearTimeout(t);
  }
}

export async function importLocalDatabaseFile(file: File): Promise<{ ok: boolean; dbPath: string }> {
  const buf = await file.arrayBuffer();
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('导入数据库超时', 'AbortError')),
    IMPORT_DATABASE_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${BASE}/api/import-database`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: buf,
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throwApiFailure('/api/import-database', res, text);
    return JSON.parse(text) as { ok: boolean; dbPath: string };
  } finally {
    clearTimeout(t);
  }
}

const XLIFF_BLOB_TIMEOUT_MS = 120_000;

export async function putXliffBlob(id: string, data: ArrayBuffer | Uint8Array): Promise<void> {
  const body = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('putXliffBlob 超时', 'AbortError')),
    XLIFF_BLOB_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${BASE}/api/xliff-blobs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `putXliffBlob failed (${res.status})`);
    }
  } finally {
    clearTimeout(t);
  }
}

export async function getXliffBlob(id: string): Promise<ArrayBuffer | null> {
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('getXliffBlob 超时', 'AbortError')),
    XLIFF_BLOB_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${BASE}/api/xliff-blobs/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
      signal: ctrl.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `getXliffBlob failed (${res.status})`);
    }
    return res.arrayBuffer();
  } finally {
    clearTimeout(t);
  }
}

export async function deleteXliffBlob(id: string): Promise<void> {
  await fetchJson(`/api/xliff-blobs/${encodeURIComponent(id)}`, { method: 'DELETE' }, 30_000);
}

export async function deleteXliffBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await fetchJson('/api/xliff-blobs/delete-many', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  }, 60_000);
}

export async function downloadLocalDatabaseExport(): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(
    () => ctrl.abort(new DOMException('导出数据库下载超时', 'AbortError')),
    EXPORT_DATABASE_TIMEOUT_MS
  );
  try {
    const res = await fetch(`${BASE}/api/export-database`, {
      headers: authHeaders(),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `导出失败 (${res.status})`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition');
    let name = 'smartcat-local.db';
    const m = cd?.match(/filename="([^"]+)"/);
    if (m?.[1]) name = m[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    clearTimeout(t);
  }
}
