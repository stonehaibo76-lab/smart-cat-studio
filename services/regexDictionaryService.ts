import type { RegexDictEntry, RegexDictionaryBook } from '../types';

export function clampRegexPriority(p?: number): number {
  const n = Number.isFinite(p as number) ? (p as number) : 0;
  return Math.max(0, Math.min(20, Math.round(n)));
}

/** $0 / $& 整匹配；$1…捕获组；$$ 字面 $ */
export function applyRegexReplacementTemplate(template: string, match: RegExpMatchArray): string {
  let out = template.replace(/\$\$/g, '\x00DOLLAR\x00');
  out = out.replace(/\$\&/g, match[0]);
  out = out.replace(/\$0\b/g, match[0]);
  out = out.replace(/\$(\d+)/g, (_, num: string) => {
    const i = parseInt(num, 10);
    return match[i] ?? '';
  });
  return out.replace(/\x00DOLLAR\x00/g, '$');
}

export function isValidRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** 按类别分组；同类内优先级从高到低 */
export function buildRegexCategoryMap(books: RegexDictionaryBook[]): Map<string, RegexDictEntry[]> {
  const map = new Map<string, RegexDictEntry[]>();
  for (const book of books) {
    if (book.enabled === false) continue;
    for (const e of book.entries) {
      if (e.enabled === false) continue;
      const cat = e.category?.trim();
      if (!cat) continue;
      const list = map.get(cat) ?? [];
      list.push(e);
      map.set(cat, list);
    }
  }
  for (const [, list] of map) {
    list.sort((a, b) => clampRegexPriority(b.priority) - clampRegexPriority(a.priority));
  }
  return map;
}

/** 类别为空的条目：句段内全局替换，按优先级依次执行（表达式优先于规则词典的场景） */
export function collectUncategorizedRegexEntries(books: RegexDictionaryBook[]): RegexDictEntry[] {
  const list: RegexDictEntry[] = [];
  for (const book of books) {
    if (book.enabled === false) continue;
    for (const e of book.entries) {
      if (e.enabled === false) continue;
      if (e.category?.trim()) continue;
      if (!e.sourcePattern.trim() || !e.targetTemplate.trim()) continue;
      list.push(e);
    }
  }
  return list.sort((a, b) => clampRegexPriority(b.priority) - clampRegexPriority(a.priority));
}

export function applyUncategorizedRegexChain(text: string, entries: RegexDictEntry[]): string {
  let out = text;
  for (const e of entries) {
    try {
      const re = new RegExp(e.sourcePattern, 'g');
      out = out.replace(re, (...args: unknown[]) => {
        const match = args[0] as string;
        const groups = args.slice(1, -2) as string[];
        const arr = [match, ...groups] as unknown as RegExpMatchArray;
        return applyRegexReplacementTemplate(e.targetTemplate, arr);
      });
    } catch {
      /* 跳过无效正则 */
    }
  }
  return out;
}
