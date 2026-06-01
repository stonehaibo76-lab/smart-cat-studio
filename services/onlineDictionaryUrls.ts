/** 第三方网页词典（仅打开站点主页，不拼接检索词） */

import type { CustomOnlineDictionary } from '../types';

export const CUSTOM_ONLINE_DICTIONARY_ID_PREFIX = 'custom:';

export type BuiltinOnlineDictionaryId =
  | 'youdao'
  | 'dictcn'
  | 'eudic'
  | 'collins'
  | 'oxford'
  | 'cambridge';

/** 内置 id 或 `custom:<条目 id>` */
export type OnlineDictionaryId = BuiltinOnlineDictionaryId | `custom:${string}`;

export interface OnlineDictionaryProvider {
  id: OnlineDictionaryId;
  label: string;
  description: string;
  /** 多数权威/商业词典站禁止 iframe（X-Frame-Options 等），为 false 时不内嵌，仅引导浏览器打开 */
  supportsIframeEmbed: boolean;
  /** 词典主页（浏览器打开 / 内嵌均使用此地址） */
  homeUrl: string;
}

export const ONLINE_DICTIONARY_PROVIDERS: OnlineDictionaryProvider[] = [
  {
    id: 'youdao',
    label: '有道词典',
    description: 'dict.youdao.com',
    supportsIframeEmbed: false,
    homeUrl: 'https://dict.youdao.com/',
  },
  {
    id: 'dictcn',
    label: '海词词典',
    description: 'dict.cn',
    supportsIframeEmbed: false,
    homeUrl: 'https://dict.cn/',
  },
  {
    id: 'eudic',
    label: '欧路词典',
    description: 'dict.eudic.net',
    supportsIframeEmbed: false,
    homeUrl: 'https://dict.eudic.net/',
  },
  {
    id: 'collins',
    label: '柯林斯词典',
    description: 'Collins Dictionary（英语）',
    supportsIframeEmbed: false,
    homeUrl: 'https://www.collinsdictionary.com/',
  },
  {
    id: 'oxford',
    label: '牛津学习词典',
    description: 'Oxford Learner\'s Dictionaries（免费网页版，非 OED）',
    supportsIframeEmbed: false,
    homeUrl: 'https://www.oxfordlearnersdictionaries.com/',
  },
  {
    id: 'cambridge',
    label: '剑桥词典',
    description: 'Cambridge Dictionary（英语）',
    supportsIframeEmbed: false,
    homeUrl: 'https://dictionary.cambridge.org/',
  },
];

export function customDictionaryProviderId(entryId: string): OnlineDictionaryId {
  return `${CUSTOM_ONLINE_DICTIONARY_ID_PREFIX}${entryId}`;
}

/** 规范化用户填写的词典主页（去除遗留的 {query} 占位符） */
export function normalizeDictionaryHomeUrl(template: string): string {
  return template.trim().replace(/\{query\}/g, '').replace(/[?&]$/, '');
}

export function isValidCustomDictionaryHomeUrl(url: string): boolean {
  const t = normalizeDictionaryHomeUrl(url);
  if (!t) return true;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function customEntryToProvider(entry: CustomOnlineDictionary): OnlineDictionaryProvider | null {
  const homeUrl = normalizeDictionaryHomeUrl(entry.searchUrlTemplate);
  if (!homeUrl || !isValidCustomDictionaryHomeUrl(entry.searchUrlTemplate)) return null;
  const label = entry.label.trim() || '自定义词典';
  return {
    id: customDictionaryProviderId(entry.id),
    label,
    description: '用户自定义（主页）',
    supportsIframeEmbed: false,
    homeUrl,
  };
}

export function getAllOnlineDictionaryProviders(
  custom: CustomOnlineDictionary[] = []
): OnlineDictionaryProvider[] {
  const customs: OnlineDictionaryProvider[] = [];
  for (const entry of custom) {
    const p = customEntryToProvider(entry);
    if (p) customs.push(p);
  }
  return [...ONLINE_DICTIONARY_PROVIDERS, ...customs];
}

export function getOnlineDictionaryProvider(
  id: OnlineDictionaryId,
  custom: CustomOnlineDictionary[] = []
): OnlineDictionaryProvider {
  const p = getAllOnlineDictionaryProviders(custom).find((x) => x.id === id);
  if (!p) throw new Error(`Unknown dictionary: ${id}`);
  return p;
}

export function isCustomOnlineDictionaryId(id: string): id is `custom:${string}` {
  return id.startsWith(CUSTOM_ONLINE_DICTIONARY_ID_PREFIX);
}

/** @deprecated 保留常量以免旧会话 storage 键报错，已不再写入 */
export const DICTIONARY_PENDING_QUERY_KEY = 'smartcat-dictionary-pending-query';

/** @deprecated 使用 isValidCustomDictionaryHomeUrl */
export const isValidCustomSearchUrlTemplate = isValidCustomDictionaryHomeUrl;
