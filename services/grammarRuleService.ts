import type { GrammarCategoryEntry, GrammarRule, GrammarRuleBook, RegexDictEntry } from '../types';
import { applyRegexReplacementTemplate } from './regexDictionaryService';

const LEGACY_SLOT_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** 句段级匹配用：首尾 trim、空白压成单空格 */
export function normalizeSegmentForGrammar(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * 末段 * 常用 (.+) 会连句末 . ? ! 等一并吃进；送 AI 后易在译文骨架中间多出「。」。
 * 在翻译 / 填入 # 之前剥掉每个 * 捕获段尾部的常见句末标点（及紧贴其后的空白）。
 */
function stripTrailingSentencePunctuationFromStarCapture(s: string): string {
  let t = s.trim();
  if (!t) return t;
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t
      .replace(/[\s\u3000]*(?:[.!?。！？]+|\u2026|\u3002|\uFF01|\uFF1F)+\s*$/u, '')
      .trimEnd();
  }
  return t.trim();
}

/** 整段为阿拉伯数字（可选小数、千分位逗号）时不送译，避免年份等被写成中文数字 */
function isNumericOnlyForPassthrough(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^\d+(?:\.\d+)?$/.test(t)) return true;
  return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t);
}

async function translateSlotOrPassthroughNumber(
  fragment: string,
  translateSlot: (fragment: string) => Promise<string>
): Promise<string> {
  const t = fragment.trim();
  if (isNumericOnlyForPassthrough(t)) return t;
  return translateSlot(fragment);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampPriority(p?: number): number {
  const n = Number.isFinite(p as number) ? (p as number) : 0;
  return Math.max(0, Math.min(20, Math.round(n)));
}

/** 含 {{变量}} 时走旧版双花括号引擎 */
export function isLegacyGrammarPattern(sourcePattern: string): boolean {
  return /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/.test(sourcePattern);
}

function splitLegacySourcePattern(sourcePattern: string): { literals: string[]; slotNames: string[] } | null {
  const slotNames: string[] = [];
  const literals: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const r = new RegExp(LEGACY_SLOT_RE.source, 'g');
  while ((m = r.exec(sourcePattern)) !== null) {
    literals.push(sourcePattern.slice(last, m.index));
    slotNames.push(m[1]);
    last = m.index + m[0].length;
  }
  literals.push(sourcePattern.slice(last));
  if (slotNames.length === 0) return null;
  return { literals, slotNames };
}

function literalToRegexFragment(lit: string): string {
  const n = normalizeSegmentForGrammar(lit);
  if (!n) return '';
  return escapeRegex(n).replace(/ /g, '\\s+');
}

/** Legacy：将源句式编译为整句正则 */
export function compileGrammarRulePattern(sourcePattern: string): RegExp | null {
  const parsed = splitLegacySourcePattern(sourcePattern);
  if (!parsed) return null;
  const { literals, slotNames } = parsed;
  try {
    let body = '';
    for (let i = 0; i < slotNames.length; i++) {
      body += literalToRegexFragment(literals[i]);
      body += '(.+?)';
    }
    body += literalToRegexFragment(literals[slotNames.length]);
    return new RegExp(`^${body}$`, 'is');
  } catch {
    return null;
  }
}

function legacyTargetContainsAllSlots(targetTemplate: string, slotNames: string[]): boolean {
  for (const name of slotNames) {
    const needle = `{{${name}}}`;
    if (!targetTemplate.includes(needle)) return false;
  }
  return true;
}

function fillLegacyTarget(targetTemplate: string, slotNames: string[], translations: string[]): string {
  const map = new Map<string, string>();
  for (let i = 0; i < slotNames.length; i++) {
    map.set(slotNames[i], translations[i]);
  }
  let out = targetTemplate;
  for (const [name, text] of map) {
    out = out.split(`{{${name}}}`).join(text);
  }
  return out;
}

// --- 雪人式：解析 ---

type SnowSegment =
  | { type: 'lit'; text: string }
  | { type: 'star' }
  | { type: 'brace'; inner: string };

function tokenizeSnowmanSource(raw: string): { segments: SnowSegment[]; anchorStart: boolean } | null {
  let s = raw.replace(/^\s+/, '');
  let anchorStart = false;
  if (s.startsWith('^')) {
    anchorStart = true;
    s = s.slice(1).replace(/^\s+/, '');
  }
  const segments: SnowSegment[] = [];
  let lit = '';
  let i = 0;

  const pushLit = () => {
    if (lit) {
      segments.push({ type: 'lit', text: lit });
      lit = '';
    }
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      lit += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '*') {
      pushLit();
      segments.push({ type: 'star' });
      i++;
      continue;
    }
    if (c === '{') {
      pushLit();
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '\\' && j + 1 < s.length) {
          j += 2;
          continue;
        }
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        j++;
      }
      if (depth !== 0) return null;
      const inner = s.slice(i + 1, j - 1);
      segments.push({ type: 'brace', inner });
      i = j;
      continue;
    }
    lit += c;
    i++;
  }
  pushLit();
  return { segments, anchorStart };
}

type BraceKind =
  | { kind: 'words'; words: string[] }
  | { kind: 'categories'; names: string[] };

function parseBraceInner(inner: string): BraceKind {
  const t = inner.trim();
  if (t.startsWith(':') || t.startsWith('：')) {
    const rest = t.slice(1);
    const words = rest
      .split('|')
      .map((w) => w.trim())
      .filter(Boolean);
    return { kind: 'words', words };
  }
  if (t.includes('|')) {
    const names = t
      .split('|')
      .map((w) => w.trim())
      .filter(Boolean);
    return { kind: 'categories', names };
  }
  return { kind: 'categories', names: [t] };
}

const BUILTIN_CATEGORY_REGEX: Record<string, string> = {
  digits: String.raw`\d+(?:\.\d+)?`,
  label: String.raw`[A-Za-z0-9]+`,
  'label:digit_': String.raw`\d[A-Za-z0-9]*`,
  'label:letter_': String.raw`[A-Za-z][A-Za-z0-9]*`,
};

function regexForNamedCategory(name: string, lex: GrammarCategoryEntry[]): string | null {
  const key = name.trim();
  const low = key.toLowerCase();
  const builtin = BUILTIN_CATEGORY_REGEX[low] ?? BUILTIN_CATEGORY_REGEX[key];
  if (builtin) return builtin;
  return categoryAlternationFromLexicon(key, lex);
}

function categoryAlternationFromLexicon(categoryName: string, lex: GrammarCategoryEntry[]): string | null {
  const sources = lex
    .filter((e) => e.category.trim() === categoryName.trim() && e.source.trim())
    .map((e) => e.source.trim())
    .sort((a, b) => b.length - a.length);
  if (sources.length === 0) return null;
  return sources.map((w) => escapeRegex(normalizeSegmentForGrammar(w)).replace(/ /g, '\\s+')).join('|');
}

function braceKindToRegex(kind: BraceKind, lex: GrammarCategoryEntry[]): string | null {
  if (kind.kind === 'words') {
    if (kind.words.length === 0) return null;
    const parts = kind.words.map((w) => escapeRegex(normalizeSegmentForGrammar(w)).replace(/ /g, '\\s+'));
    return parts.join('|');
  }
  const alts: string[] = [];
  for (const name of kind.names) {
    const re = regexForNamedCategory(name, lex);
    if (!re) return null;
    alts.push(re);
  }
  if (alts.length === 0) return null;
  return alts.length === 1 ? alts[0] : `(?:${alts.join('|')})`;
}

function snowmanUsesRegexCategory(
  segments: SnowSegment[],
  regexByCat: Map<string, RegexDictEntry[]>
): boolean {
  for (const s of segments) {
    if (s.type !== 'brace') continue;
    const kind = parseBraceInner(s.inner);
    if (kind.kind === 'words') continue;
    for (const n of kind.names) {
      if ((regexByCat.get(n.trim()) ?? []).length > 0) return true;
    }
  }
  return false;
}

function snowmanBraceResolvable(
  inner: string,
  lex: GrammarCategoryEntry[],
  regexByCat: Map<string, RegexDictEntry[]>
): boolean {
  const kind = parseBraceInner(inner);
  if (kind.kind === 'words') return kind.words.length > 0;
  return kind.names.some((name) => {
    const t = name.trim();
    if ((regexByCat.get(t) ?? []).length > 0) return true;
    return regexForNamedCategory(t, lex) !== null;
  });
}

function matchLiteralPrefix(text: string, pos: number, lit: string): number | null {
  const frag = literalToRegexFragment(lit);
  if (!frag) return pos;
  try {
    const re = new RegExp('^' + frag, 's');
    const m = re.exec(text.slice(pos));
    return m ? pos + m[0].length : null;
  } catch {
    return null;
  }
}

function tryRegexCategoryAt(
  text: string,
  pos: number,
  categoryName: string,
  regexByCat: Map<string, RegexDictEntry[]>
): { end: number; output: string } | null {
  const rules = regexByCat.get(categoryName.trim()) ?? [];
  const slice = text.slice(pos);
  for (const rule of rules) {
    try {
      const anchored = rule.sourcePattern.startsWith('^')
        ? rule.sourcePattern
        : '(?:' + rule.sourcePattern + ')';
      const re = new RegExp('^' + anchored);
      const m = re.exec(slice);
      if (m) {
        return {
          end: pos + m[0].length,
          output: applyRegexReplacementTemplate(rule.targetTemplate, m),
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function tryBraceAt(
  text: string,
  pos: number,
  inner: string,
  lex: GrammarCategoryEntry[],
  regexByCat: Map<string, RegexDictEntry[]>
): { end: number; output: string } | null {
  const kind = parseBraceInner(inner);
  if (kind.kind === 'words') {
    const reStr = braceKindToRegex(kind, lex);
    if (!reStr) return null;
    try {
      const re = new RegExp('^(?:' + reStr + ')', 's');
      const m = re.exec(text.slice(pos));
      if (!m) return null;
      return { end: pos + m[0].length, output: m[0] };
    } catch {
      return null;
    }
  }
  for (const name of kind.names) {
    const trimmed = name.trim();
    const rules = regexByCat.get(trimmed) ?? [];
    if (rules.length > 0) {
      const hit = tryRegexCategoryAt(text, pos, trimmed, regexByCat);
      if (hit) return hit;
      continue;
    }
    const innerRe = regexForNamedCategory(trimmed, lex);
    if (!innerRe) continue;
    try {
      const re = new RegExp('^(?:' + innerRe + ')', 's');
      const m = re.exec(text.slice(pos));
      if (!m) continue;
      const resolved = resolveBraceTranslation(m[0], { kind: 'categories', names: [trimmed] }, lex);
      if (!resolved) continue;
      return { end: pos + m[0].length, output: resolved };
    } catch {
      continue;
    }
  }
  return null;
}

function snowmanSequentialMatch(
  text: string,
  segments: SnowSegment[],
  lex: GrammarCategoryEntry[],
  regexByCat: Map<string, RegexDictEntry[]>
): { stars: string[]; braces: string[] } | null {
  function dfs(
    pos: number,
    si: number,
    stars: string[],
    braces: string[]
  ): { stars: string[]; braces: string[] } | null {
    if (si >= segments.length) {
      return pos === text.length ? { stars, braces } : null;
    }
    const seg = segments[si];
    if (seg.type === 'lit') {
      const np = matchLiteralPrefix(text, pos, seg.text);
      if (np === null) return null;
      return dfs(np, si + 1, stars, braces);
    }
    if (seg.type === 'brace') {
      const b = tryBraceAt(text, pos, seg.inner, lex, regexByCat);
      if (!b) return null;
      return dfs(b.end, si + 1, stars, [...braces, b.output]);
    }
    for (let end = pos + 1; end <= text.length; end++) {
      const frag = text.slice(pos, end);
      if (!frag.trim()) continue;
      const sub = dfs(end, si + 1, [...stars, frag], braces);
      if (sub) return sub;
    }
    return null;
  }
  return dfs(0, 0, [], []);
}

export interface CompiledSnowmanRule {
  regex: RegExp;
  starGroupIndices: number[];
  braceGroupIndices: number[];
  braceKinds: BraceKind[];
}

export function compileSnowmanRule(
  sourcePattern: string,
  categoryLexicon: GrammarCategoryEntry[]
): CompiledSnowmanRule | null {
  const tok = tokenizeSnowmanSource(sourcePattern);
  if (!tok) return null;
  const { segments } = tok;
  if (segments.length === 0) return null;
  if (segments[0].type === 'star') return null;

  let body = '';
  let group = 1;
  const starGroupIndices: number[] = [];
  const braceGroupIndices: number[] = [];
  const braceKinds: BraceKind[] = [];

  const isLastWildcard = (idx: number): boolean => {
    for (let k = idx + 1; k < segments.length; k++) {
      if (segments[k].type === 'star' || segments[k].type === 'brace') return false;
    }
    return true;
  };

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (seg.type === 'lit') {
      body += literalToRegexFragment(seg.text);
    } else if (seg.type === 'star') {
      body += isLastWildcard(si) ? '(.+)' : '(.+?)';
      starGroupIndices.push(group++);
    } else {
      const kind = parseBraceInner(seg.inner);
      const innerRe = braceKindToRegex(kind, categoryLexicon);
      if (!innerRe) return null;
      body += `(${innerRe})`;
      braceGroupIndices.push(group++);
      braceKinds.push(kind);
    }
  }

  try {
    const regex = new RegExp(`^${body}$`, 'is');
    return { regex, starGroupIndices, braceGroupIndices, braceKinds };
  } catch {
    return null;
  }
}

function splitTargetAlternatives(template: string): string[] {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === '\\' && i + 1 < template.length) {
      cur += c + template[i + 1];
      i++;
      continue;
    }
    if (c === '|') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function unescapeSnowmanOutput(s: string): string {
  return s.replace(/\\([*#{}@^~\\|])/g, '$1');
}

function lookupCategoryTranslation(fragment: string, categoryName: string, lex: GrammarCategoryEntry[]): string | null {
  const t = fragment.trim();
  if (!t) return null;
  const hit = lex.find(
    (e) =>
      e.category.trim() === categoryName.trim() &&
      e.source.trim().toLowerCase() === t.toLowerCase()
  );
  return hit ? hit.target.trim() : null;
}

function resolveBraceTranslation(
  captured: string,
  kind: BraceKind,
  lex: GrammarCategoryEntry[]
): string | null {
  const cap = captured.trim();
  if (!cap) return null;
  if (kind.kind === 'words') return cap;

  for (const name of kind.names) {
    const key = name.trim();
    const low = key.toLowerCase();
    if (BUILTIN_CATEGORY_REGEX[low] ?? BUILTIN_CATEGORY_REGEX[key]) {
      return cap;
    }
    const tr = lookupCategoryTranslation(cap, key, lex);
    if (tr) return tr;
  }
  return null;
}

function fillSnowmanTargetFromOutputs(
  targetTemplate: string,
  starTexts: string[],
  braceOutputs: string[]
): string | null {
  const variants = splitTargetAlternatives(targetTemplate);
  const primary = variants[0] ?? '';
  if (!primary.trim()) return null;
  let out = primary;
  for (let n = 9; n >= 1; n--) {
    const starVal = starTexts[n - 1];
    if (starVal !== undefined) {
      out = out.split(`#${n}`).join(starVal);
    }
    const braceVal = braceOutputs[n - 1];
    if (braceVal !== undefined) {
      out = out.split(`@${n}`).join(braceVal);
    }
  }
  out = out.replace(/(?<!\d)#(?!\d)/g, starTexts[0] ?? '');
  out = unescapeSnowmanOutput(out);
  return out;
}

function fillSnowmanTarget(
  targetTemplate: string,
  starTexts: string[],
  braceTexts: string[],
  braceKinds: BraceKind[],
  lex: GrammarCategoryEntry[]
): string | null {
  const variants = splitTargetAlternatives(targetTemplate);
  const primary = variants[0] ?? '';
  if (!primary.trim()) return null;

  const braceResolved: string[] = [];
  for (let i = 0; i < braceTexts.length; i++) {
    const r = resolveBraceTranslation(braceTexts[i], braceKinds[i], lex);
    if (!r) return null;
    braceResolved.push(r);
  }

  let out = primary;
  for (let n = 9; n >= 1; n--) {
    const starVal = starTexts[n - 1];
    if (starVal !== undefined) {
      out = out.split(`#${n}`).join(starVal);
    }
    const braceVal = braceResolved[n - 1];
    if (braceVal !== undefined) {
      out = out.split(`@${n}`).join(braceVal);
    }
  }
  out = out.replace(/(?<!\d)#(?!\d)/g, starTexts[0] ?? '');
  out = unescapeSnowmanOutput(out);

  return out;
}

/** 规则源句式是否有效（Legacy 或雪人式）；可提供正则词典类别映射以校验 {金额} 等 */
export function grammarRuleSourceLooksValid(
  sourcePattern: string,
  categoryLexicon: GrammarCategoryEntry[],
  regexByCategory?: Map<string, RegexDictEntry[]>
): boolean {
  const s = sourcePattern.trim();
  if (!s) return false;
  if (isLegacyGrammarPattern(s)) return compileGrammarRulePattern(s) !== null;
  const rx = regexByCategory ?? new Map<string, RegexDictEntry[]>();
  if (compileSnowmanRule(s, categoryLexicon) !== null) return true;
  const tok = tokenizeSnowmanSource(s);
  if (!tok || tok.segments.length === 0 || tok.segments[0].type === 'star') return false;
  return tok.segments.every((seg) => {
    if (seg.type !== 'brace') return true;
    return snowmanBraceResolvable(seg.inner, categoryLexicon, rx);
  });
}

/** 保存前校验：Legacy 还须译文含全部 {{变量}} */
export function grammarRulePairLooksValid(
  rule: GrammarRule,
  categoryLexicon: GrammarCategoryEntry[],
  regexByCategory?: Map<string, RegexDictEntry[]>
): boolean {
  if (!rule.sourcePattern.trim() || !rule.targetTemplate.trim()) return false;
  const src = rule.sourcePattern;
  if (isLegacyGrammarPattern(src)) {
    const parsed = splitLegacySourcePattern(src);
    if (!parsed || !compileGrammarRulePattern(src)) return false;
    return legacyTargetContainsAllSlots(rule.targetTemplate, parsed.slotNames);
  }
  return grammarRuleSourceLooksValid(src, categoryLexicon, regexByCategory);
}

export interface MountedGrammarRule {
  rule: GrammarRule;
  categoryLexicon: GrammarCategoryEntry[];
}

export function flattenAndSortGrammarRules(books: GrammarRuleBook[]): MountedGrammarRule[] {
  const list: MountedGrammarRule[] = [];
  for (const book of books) {
    if (book.enabled === false) continue;
    const lex = book.categoryLexicon ?? [];
    for (const r of book.rules) {
      if (r.enabled === false) continue;
      if (r.temporary) continue;
      if (!r.targetTemplate?.trim()) continue;
      list.push({ rule: r, categoryLexicon: lex });
    }
  }
  return list.sort((a, b) => {
    const pr = clampPriority(b.rule.priority) - clampPriority(a.rule.priority);
    if (pr !== 0) return pr;
    return (b.rule.sourcePattern?.length ?? 0) - (a.rule.sourcePattern?.length ?? 0);
  });
}

/**
 * 若整句匹配某条规则：Legacy 时对捕获段调用 translateSlot；
 * 雪人式时仅对 `*` 捕获段调用 translateSlot，`{}` 段用类别词典或内置字面。
 */
export async function tryGrammarRuleTranslation(
  sourceText: string,
  mountedRules: MountedGrammarRule[],
  translateSlot: (fragment: string) => Promise<string>,
  regexByCategory: Map<string, RegexDictEntry[]> = new Map()
): Promise<string | null> {
  const normalized = normalizeSegmentForGrammar(sourceText);

  for (const { rule, categoryLexicon } of mountedRules) {
    const src = rule.sourcePattern;

    if (isLegacyGrammarPattern(src)) {
      const parsed = splitLegacySourcePattern(src);
      if (!parsed) continue;
      const { slotNames } = parsed;
      if (new Set(slotNames).size !== slotNames.length) continue;
      if (!legacyTargetContainsAllSlots(rule.targetTemplate, slotNames)) continue;

      const regex = compileGrammarRulePattern(src);
      if (!regex) continue;

      const m = normalized.match(regex);
      if (!m) continue;

      const captures = slotNames.map((_, i) => (m[i + 1] ?? '').trim());
      if (captures.some((c) => !c)) continue;

      const translations = await Promise.all(
        captures.map((c) => translateSlotOrPassthroughNumber(c, translateSlot))
      );
      if (translations.some((t) => !t || !t.trim())) continue;

      return fillLegacyTarget(rule.targetTemplate, slotNames, translations.map((t) => t.trim()));
    }

    const tokSnow = tokenizeSnowmanSource(src);
    if (!tokSnow || tokSnow.segments[0]?.type === 'star') continue;

    if (snowmanUsesRegexCategory(tokSnow.segments, regexByCategory)) {
      const seq = snowmanSequentialMatch(normalized, tokSnow.segments, categoryLexicon, regexByCategory);
      if (!seq) continue;
      const starsForTr = seq.stars.map((c) => stripTrailingSentencePunctuationFromStarCapture(c));
      if (starsForTr.some((t) => !t.trim())) continue;
      const starTranslations = await Promise.all(
        starsForTr.map((c) => translateSlotOrPassthroughNumber(c, translateSlot))
      );
      if (starTranslations.some((t) => !t || !t.trim())) continue;
      const filledSeq = fillSnowmanTargetFromOutputs(
        rule.targetTemplate,
        starTranslations.map((t) => t.trim()),
        seq.braces
      );
      if (filledSeq !== null && filledSeq.trim()) return filledSeq;
      continue;
    }

    const compiled = compileSnowmanRule(src, categoryLexicon);
    if (!compiled) continue;

    const m = normalized.match(compiled.regex);
    if (!m) continue;

    const starTexts = compiled.starGroupIndices.map((gi) =>
      stripTrailingSentencePunctuationFromStarCapture((m[gi] ?? '').trim())
    );
    const braceTexts = compiled.braceGroupIndices.map((gi) => (m[gi] ?? '').trim());

    if (starTexts.some((t) => !t)) continue;
    if (braceTexts.some((t) => !t)) continue;

    const starTranslations = await Promise.all(
      starTexts.map((c) => translateSlotOrPassthroughNumber(c, translateSlot))
    );
    if (starTranslations.some((t) => !t || !t.trim())) continue;

    const filled = fillSnowmanTarget(
      rule.targetTemplate,
      starTranslations.map((t) => t.trim()),
      braceTexts,
      compiled.braceKinds,
      categoryLexicon
    );
    if (filled !== null && filled.trim()) return filled;
  }

  return null;
}
