import type { Project, TermBase, TranslationMemory, TwinTranslatorProfile, KnowledgeBase, GrammarRuleBook, RegexDictionaryBook } from '../types';
import * as localApi from './localBackendClient';

let backendAvailable: boolean | null = null;

export const BACKEND_REQUIRED_MESSAGE =
  '未连接到后端 API。请先启动本地后端（npm run dev:with-db 或 npm run server），或检查 VITE_API_BASE_URL 配置。';

async function resolveBackendAvailability(): Promise<boolean> {
  if (backendAvailable !== null) return backendAvailable;
  backendAvailable = await localApi.pingLocalBackend();
  if (backendAvailable) {
    console.info('[SmartCAT] 已连接本地后端，数据写入 SQLite（磁盘）');
  } else {
    console.error('[SmartCAT] 本地后端未启动。当前为强制 SQLite 模式，已禁止回退到 IndexedDB。');
  }
  return backendAvailable;
}

async function requireLocalBackend(): Promise<void> {
  const available = await resolveBackendAvailability();
  if (!available) {
    throw new Error(BACKEND_REQUIRED_MESSAGE);
  }
}

export const loadAllData = async (opts?: { omitHeavyCollections?: boolean }) => {
  await requireLocalBackend();
  return localApi.loadAllData(opts);
};

export const loadSetting = async (key: string): Promise<unknown | null> => {
  await requireLocalBackend();
  return localApi.loadSetting(key);
};

export const saveProjects = async (projects: Project[]) => {
  await requireLocalBackend();
  return localApi.saveProjects(projects);
};

export const saveTermBases = async (tbs: TermBase[]) => {
  await requireLocalBackend();
  return localApi.saveTermBases(tbs);
};

export const saveTMs = async (tms: TranslationMemory[]) => {
  await requireLocalBackend();
  return localApi.saveTMs(tms);
};

export const saveTwinTranslators = async (twinTranslators: TwinTranslatorProfile[]) => {
  await requireLocalBackend();
  return localApi.saveTwinTranslators(twinTranslators);
};

export const saveKnowledgeBases = async (list: KnowledgeBase[]) => {
  await requireLocalBackend();
  return localApi.saveKnowledgeBases(list);
};

export const saveGrammarRuleBooks = async (list: GrammarRuleBook[]) => {
  await requireLocalBackend();
  return localApi.saveGrammarRuleBooks(list);
};

export const saveRegexDictionaryBooks = async (list: RegexDictionaryBook[]) => {
  await requireLocalBackend();
  return localApi.saveRegexDictionaryBooks(list);
};

export const getTwinTranslatorById = async (id: string) => {
  await requireLocalBackend();
  const all = await localApi.loadAllData().then((d) => d.twinTranslators);
  return all.find((t) => t.id === id);
};

export const getAllTwinTranslators = async () => {
  await requireLocalBackend();
  return localApi.loadAllData().then((d) => d.twinTranslators);
};

export const getTwinTranslatorsByLanguagePair = async (languagePair: string) => {
  await requireLocalBackend();
  const all = await localApi.loadAllData().then((d) => d.twinTranslators);
  return all.filter((t) => t.languagePair === languagePair);
};

export const saveSettings = async (key: string, value: unknown) => {
  await requireLocalBackend();
  return localApi.saveSettings(key, value);
};

/** 强制 SQLite 模式下禁用 IndexedDB 初始化。 */
export const initDB = async () => {
  await requireLocalBackend();
  throw new Error('强制 SQLite 模式已启用，不支持初始化 IndexedDB。');
};
