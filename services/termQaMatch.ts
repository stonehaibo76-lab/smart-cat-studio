import type { TermBaseEntry } from '../types';

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Term whose source is only ASCII letters (word-boundary semantics for QA). */
export function isAsciiAlphaTerm(source: string): boolean {
  return /^[a-zA-Z]+$/.test(source.trim());
}

function matchesAt(
  sourceText: string,
  index: number,
  term: TermBaseEntry,
  ignoreCase: boolean
): boolean {
  const src = term.source;
  const len = src.length;
  if (len === 0 || index + len > sourceText.length) return false;

  const slice = sourceText.slice(index, index + len);
  const equal = ignoreCase
    ? slice.toLowerCase() === src.toLowerCase()
    : slice === src;
  if (!equal) return false;

  if (isAsciiAlphaTerm(src)) {
    const before = index > 0 ? sourceText[index - 1] : '';
    const after = index + len < sourceText.length ? sourceText[index + len] : '';
    if (before && /[A-Za-z]/.test(before)) return false;
    if (after && /[A-Za-z]/.test(after)) return false;
  }
  return true;
}

export interface TermHitSpan {
  start: number;
  end: number;
  term: TermBaseEntry;
}

/** Longest-first non-overlapping hits on the source (QA + 原文高亮共用). */
export function collectTermHitSpans(
  sourceText: string,
  allEntries: TermBaseEntry[],
  ignoreCase: boolean
): TermHitSpan[] {
  const entries = allEntries.filter((e) => e.source.trim());
  const sorted = [...entries].sort(
    (a, b) => b.source.length - a.source.length || a.id.localeCompare(b.id)
  );

  const spans: TermHitSpan[] = [];
  let i = 0;
  const n = sourceText.length;

  while (i < n) {
    let hit: TermBaseEntry | null = null;
    for (const e of sorted) {
      if (matchesAt(sourceText, i, e, ignoreCase)) {
        hit = e;
        break;
      }
    }
    if (hit) {
      spans.push({ start: i, end: i + hit.source.length, term: hit });
      i += hit.source.length;
    } else {
      i += 1;
    }
  }
  return spans;
}

export interface TermHitSegment {
  text: string;
  term: TermBaseEntry | null;
}

/** Split source into plain / term spans for UI highlighting (与 QA 规则一致). */
export function segmentSourceByTermHits(
  sourceText: string,
  allEntries: TermBaseEntry[],
  ignoreCase: boolean = false
): TermHitSegment[] {
  const spans = collectTermHitSpans(sourceText, allEntries, ignoreCase);
  if (spans.length === 0) {
    return [{ text: sourceText, term: null }];
  }

  const out: TermHitSegment[] = [];
  let cursor = 0;
  const n = sourceText.length;
  for (const span of spans) {
    if (cursor < span.start) {
      out.push({ text: sourceText.slice(cursor, span.start), term: null });
    }
    out.push({
      text: sourceText.slice(span.start, span.end),
      term: span.term,
    });
    cursor = span.end;
  }
  if (cursor < n) {
    out.push({ text: sourceText.slice(cursor), term: null });
  }
  return out;
}

function collectMatchedTermIds(
  sourceText: string,
  allEntries: TermBaseEntry[],
  ignoreCase: boolean
): Set<string> {
  return new Set(
    collectTermHitSpans(sourceText, allEntries, ignoreCase).map((s) => s.term.id)
  );
}

export function termSourceHitsSegment(
  sourceText: string,
  term: TermBaseEntry,
  allEntries: TermBaseEntry[],
  ignoreCase: boolean
): boolean {
  if (!term.source.trim()) return false;
  return collectMatchedTermIds(sourceText, allEntries, ignoreCase).has(term.id);
}

/** Whether the target text contains the mandatory translation (bounded for pure ASCII-letter targets). */
export function targetContainsTermTranslation(
  targetText: string,
  term: TermBaseEntry,
  ignoreCase: boolean
): boolean {
  const tgt = term.target;
  if (!tgt.trim()) return false;

  if (isAsciiAlphaTerm(tgt)) {
    const re = new RegExp(
      `(?<![A-Za-z])${escapeRegExp(tgt)}(?![A-Za-z])`,
      ignoreCase ? 'i' : ''
    );
    return re.test(targetText);
  }

  if (ignoreCase) {
    return targetText.toLowerCase().includes(tgt.toLowerCase());
  }
  return targetText.includes(tgt);
}
