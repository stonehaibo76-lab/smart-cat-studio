import type { QAIssue, Segment, TermBaseEntry } from '../types';
import { stripInlineMarkers } from './inlineFormatting/markerParse';
import {
  filterTermsMatchingSource,
  targetContainsTermTranslation,
} from './termQaMatch';

export interface LocalQaConfig {
  numberAccuracy: boolean;
  termMatch: boolean;
  punctuationPair: boolean;
  untranslated: boolean;
  sourceTargetSame: boolean;
  repeatedWords: boolean;
  targetLength: boolean;
  inconsistency: boolean;
  sentenceCapitalization: boolean;
  ignoreCase: boolean;
}

export interface LocalQaRunOptions {
  /** Soft time budget per turn before yielding to the UI thread (ms). */
  budgetMs?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** sourceText → distinct non-empty target texts in the file */
export function buildInconsistencyIndex(
  segments: ReadonlyArray<Pick<Segment, 'sourceText' | 'targetText'>>
): Map<string, string[]> {
  const bySource = new Map<string, Set<string>>();
  for (const seg of segments) {
    const t = seg.targetText;
    if (!t || !t.trim()) continue;
    let set = bySource.get(seg.sourceText);
    if (!set) {
      set = new Set();
      bySource.set(seg.sourceText, set);
    }
    set.add(t);
  }
  const out = new Map<string, string[]>();
  for (const [source, targets] of bySource) {
    out.set(source, Array.from(targets));
  }
  return out;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Local QA aborted', 'AbortError');
  }
}

function collectRepetitionMatches(target: string, targetLang: string): string[] {
  const repetitionMatches: string[] = [];

  if (targetLang.startsWith('zh-')) {
    const chineseCharRepeatRegex = /([\u4e00-\u9fa5])\1{1,}/g;
    let charMatch;
    while ((charMatch = chineseCharRepeatRegex.exec(target)) !== null) {
      repetitionMatches.push(charMatch[0]);
      if (chineseCharRepeatRegex.lastIndex === charMatch.index) break;
    }

    const chineseWordRepeatRegex = /([\u4e00-\u9fa5]{2})\1{1,}/g;
    let wordMatch;
    while ((wordMatch = chineseWordRepeatRegex.exec(target)) !== null) {
      repetitionMatches.push(wordMatch[0]);
      if (chineseWordRepeatRegex.lastIndex === wordMatch.index) break;
    }

    const chineseAbabRepeatRegex = /([\u4e00-\u9fa5])([\u4e00-\u9fa5])\1\2/g;
    let ababMatch;
    while ((ababMatch = chineseAbabRepeatRegex.exec(target)) !== null) {
      repetitionMatches.push(ababMatch[0]);
      if (chineseAbabRepeatRegex.lastIndex === ababMatch.index) break;
    }

    const chinesePhraseRepeatRegex = /([\u4e00-\u9fa5]{3})\1{1,}/g;
    let phraseMatch;
    while ((phraseMatch = chinesePhraseRepeatRegex.exec(target)) !== null) {
      repetitionMatches.push(phraseMatch[0]);
      if (chinesePhraseRepeatRegex.lastIndex === phraseMatch.index) break;
    }
  } else {
    const englishWordRepeatRegex = /(\b\w+\b)\s+\1\b/gi;
    let wordMatch;
    while ((wordMatch = englishWordRepeatRegex.exec(target)) !== null) {
      repetitionMatches.push(wordMatch[0]);
      if (englishWordRepeatRegex.lastIndex === wordMatch.index) break;
    }

    const englishCapWordRepeatRegex = /(\b[A-Z]\w+)\s+(\w+)\b/g;
    let capMatch;
    while ((capMatch = englishCapWordRepeatRegex.exec(target)) !== null) {
      if (capMatch[1].toLowerCase() === capMatch[2].toLowerCase()) {
        repetitionMatches.push(capMatch[0]);
      }
      if (englishCapWordRepeatRegex.lastIndex === capMatch.index) break;
    }

    const englishPhraseRepeatRegex = /(\b\w+\s+\w+\b)\s+\1\b/gi;
    let phraseMatch;
    while ((phraseMatch = englishPhraseRepeatRegex.exec(target)) !== null) {
      repetitionMatches.push(phraseMatch[0]);
      if (englishPhraseRepeatRegex.lastIndex === phraseMatch.index) break;
    }
  }

  return repetitionMatches;
}

/**
 * Run local QA on a single segment.
 * Pass `inconsistencyBySource` (from {@link buildInconsistencyIndex}) when inconsistency is enabled
 * so per-segment work stays O(1) instead of scanning the whole file.
 */
export function runLocalQaOnSegment(
  seg: Segment,
  targetLang: string,
  config: LocalQaConfig,
  termEntries?: ReadonlyArray<TermBaseEntry>,
  inconsistencyBySource?: Map<string, string[]>
): QAIssue[] {
  const issues: QAIssue[] = [];
  const s = seg.sourceText;
  const t = seg.targetText;

  if (!t) return [];

  if (config.sourceTargetSame) {
    const st = s.trim();
    const tt = t.trim();
    if (st && st === tt) {
      issues.push({
        id: `qa-same-${seg.id}`,
        type: 'warning',
        category: '原文译文',
        message: '原文和译文相同',
      });
    }
  }

  if (config.numberAccuracy) {
    const getNums = (str: string) =>
      stripInlineMarkers(str).match(/\d+/g)?.sort().join(',') || '';
    if (getNums(s) !== getNums(t)) {
      issues.push({
        id: `qa-num-${seg.id}`,
        type: 'error',
        category: '数字',
        message: '原文与译文数字不匹配',
      });
    }
  }

  if (config.termMatch && termEntries && termEntries.length > 0) {
    // One longest-first scan of the source, then check targets — not O(terms²).
    const matched = filterTermsMatchingSource(s, termEntries as TermBaseEntry[], config.ignoreCase);
    for (const term of matched) {
      if (!targetContainsTermTranslation(t, term, config.ignoreCase)) {
        issues.push({
          id: `qa-term-${seg.id}-${term.id}`,
          type: 'warning',
          category: '术语',
          message: `缺失术语翻译: ${term.source} -> ${term.target}`,
        });
      }
    }
  }

  if (config.punctuationPair) {
    const checkPair = (charA: string, charB: string) => {
      const countA = t.split(charA).length - 1;
      const countB = t.split(charB).length - 1;
      return countA === countB;
    };
    if (!checkPair('(', ')') || !checkPair('（', '）')) {
      issues.push({
        id: `qa-punc-br-${seg.id}`,
        type: 'warning',
        category: '标点',
        message: '括号不匹配',
      });
    }
    if (!checkPair('[', ']') || !checkPair('【', '】')) {
      issues.push({
        id: `qa-punc-sq-${seg.id}`,
        type: 'warning',
        category: '标点',
        message: '方括号不匹配',
      });
    }
  }

  if (config.untranslated) {
    const sameTrimmed = s.trim() === t.trim();
    if (/[a-zA-Z]/.test(s) && sameTrimmed && !(config.sourceTargetSame && sameTrimmed)) {
      issues.push({
        id: `qa-untrans-${seg.id}`,
        type: 'error',
        category: '未翻译',
        message: '译文与原文相同',
      });
    }
  }

  if (config.repeatedWords) {
    const repetitionMatches = collectRepetitionMatches(t, targetLang);
    if (repetitionMatches.length > 0) {
      const uniqueMatches = [...new Set(repetitionMatches)];
      const firstMatch = uniqueMatches[0];
      issues.push({
        id: `qa-repeat-${seg.id}`,
        type: 'warning',
        category: '重复',
        message: `发现重复内容: ${firstMatch}${uniqueMatches.length > 1 ? ' 等' : ''}`,
      });
    }
  }

  if (config.targetLength) {
    if (t.length > s.length * 2.5) {
      issues.push({
        id: `qa-len-${seg.id}`,
        type: 'warning',
        category: '长度',
        message: '译文过长 (>250%)',
      });
    }
  }

  if (config.inconsistency && inconsistencyBySource) {
    if (t.trim()) {
      const targets = inconsistencyBySource.get(s);
      const other = targets?.find((x) => x !== t);
      if (other) {
        const truncated = other.length > 10 ? other.substring(0, 10) + '...' : other;
        issues.push({
          id: `qa-inc-${seg.id}`,
          type: 'warning',
          category: '一致性',
          message: `译文不一致 (如: ${truncated})`,
        });
      }
    }
  }

  if (config.sentenceCapitalization) {
    const trimmedTarget = t.trim();
    if (trimmedTarget) {
      const firstChar = trimmedTarget[0];
      if (/[a-z]/.test(firstChar)) {
        issues.push({
          id: `qa-cap-${seg.id}`,
          type: 'warning',
          category: '大小写',
          message: '译文句首字母应为大写',
        });
      }
    }
  }

  return issues;
}

/**
 * Full-file local QA with cooperative yielding so the UI stays responsive on large docs.
 */
export async function runLocalQaOnSegments(
  segments: Segment[],
  targetLang: string,
  config: LocalQaConfig,
  termEntries?: ReadonlyArray<TermBaseEntry>,
  options?: LocalQaRunOptions
): Promise<Segment[]> {
  const budgetMs = options?.budgetMs ?? 12;
  const signal = options?.signal;
  const total = segments.length;
  const inconsistencyBySource = config.inconsistency
    ? buildInconsistencyIndex(segments)
    : undefined;

  const updated: Segment[] = new Array(total);
  let lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();

  for (let i = 0; i < total; i++) {
    throwIfAborted(signal);
    const seg = segments[i];
    updated[i] = {
      ...seg,
      qaIssues: runLocalQaOnSegment(
        seg,
        targetLang,
        config,
        termEntries,
        inconsistencyBySource
      ),
    };

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const isLast = i === total - 1;
    if (isLast || now - lastYield >= budgetMs) {
      options?.onProgress?.(i + 1, total);
      if (!isLast) {
        await yieldToMain();
        throwIfAborted(signal);
        lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();
      }
    }
  }

  return updated;
}
