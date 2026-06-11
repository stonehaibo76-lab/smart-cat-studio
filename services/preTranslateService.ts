import {
  MatchType,
  SegmentStatus,
  type PreTranslateStrategy,
  type AISettings,
  type MtReferenceSettings,
  type Segment,
  type TermBaseEntry,
  type TranslationMemory,
} from '../types';
import { tryGrammarRuleTranslation, normalizeSegmentForGrammar } from './grammarRuleService';
import { applyUncategorizedRegexChain } from './regexDictionaryService';
import { translateSegment } from './geminiService';
import { fetchMtReference } from './mtReferenceClient';
import { findExactTmMatch, searchTmMatches } from './tmMatchService';

export type { PreTranslateStrategy };

export type PreTranslateOptions = {
  strategy: PreTranslateStrategy;
  fuzzyThreshold?: number;
  contextDescription?: string;
  ragContext?: string;
  buildRagContext?: (sourceText: string) => Promise<string>;
  aiSettings: AISettings;
  mtSettings?: MtReferenceSettings;
  sourceLang: string;
  targetLang: string;
  tms: TranslationMemory[];
  grammarRulesSorted?: Parameters<typeof tryGrammarRuleTranslation>[1];
  regexCategoryMap?: Map<string, import('./regexDictionaryService').RegexDictEntry[]>;
  uncategorizedRegexEntries?: import('../types').RegexDictEntry[];
  glossaryPairs?: { source: string; target: string }[];
  allTerms?: TermBaseEntry[];
  mtTranslatorId?: string;
};

export type PreTranslateResult = {
  targetText: string;
  status: SegmentStatus;
  matchType: MatchType;
  matchScore?: number;
  source: 'tm' | 'fuzzy' | 'rule' | 'mt' | 'llm' | 'none';
};

async function tryLlmTranslate(
  sourceText: string,
  opts: PreTranslateOptions
): Promise<string> {
  const glossaryPairs = opts.glossaryPairs ?? glossaryFromTerms(sourceText, opts.allTerms ?? []);
  const normalized = normalizeSegmentForGrammar(sourceText);
  const pipelineSource = opts.uncategorizedRegexEntries?.length
    ? applyUncategorizedRegexChain(normalized, opts.uncategorizedRegexEntries)
    : normalized;

  if (opts.grammarRulesSorted?.length || opts.regexCategoryMap?.size) {
    const viaRule = await tryGrammarRuleTranslation(
      pipelineSource,
      opts.grammarRulesSorted ?? [],
      async (frag) =>
        translateSegment(
          frag,
          opts.targetLang,
          opts.sourceLang,
          '仅输出该片段的目标语译文，不要解释。',
          opts.glossaryPairs ?? glossaryPairs,
          opts.aiSettings,
          ''
        ),
      opts.regexCategoryMap ?? new Map()
    );
    if (viaRule !== null) return viaRule;
  }

  return translateSegment(
    pipelineSource,
    opts.targetLang,
    opts.sourceLang,
    opts.contextDescription,
    glossaryPairs,
    opts.aiSettings,
    opts.ragContext ?? ''
  );
}

export async function preTranslateSegment(
  sourceText: string,
  opts: PreTranslateOptions
): Promise<PreTranslateResult | null> {
  if (!sourceText?.trim()) return null;

  const threshold = opts.fuzzyThreshold ?? 75;
  const strategy = opts.strategy;

  if (strategy !== 'llmOnly') {
    const exact = findExactTmMatch(sourceText, opts.tms);
    if (exact) {
      return {
        targetText: exact.target,
        status: SegmentStatus.PreTranslated,
        matchType: MatchType.Exact,
        matchScore: 100,
        source: 'tm',
      };
    }

    const fuzzyHits = await searchTmMatches(sourceText, opts.tms, threshold, 1);
    if (fuzzyHits.length > 0 && fuzzyHits[0].score >= threshold) {
      return {
        targetText: fuzzyHits[0].target,
        status: SegmentStatus.PreTranslated,
        matchType: fuzzyHits[0].score >= 100 ? MatchType.Exact : MatchType.Fuzzy,
        matchScore: fuzzyHits[0].score,
        source: fuzzyHits[0].score >= 100 ? 'tm' : 'fuzzy',
      };
    }

    if (strategy === 'tmOnly') {
      return null;
    }
  }

  if (strategy === 'tmOnly') return null;

  if (strategy === 'tmMt' || strategy === 'tmMtLlm') {
    if (opts.mtSettings?.enabled !== false) {
      try {
        const mt = await fetchMtReference(
          sourceText,
          opts.mtTranslatorId || opts.mtSettings?.defaultTranslator || 'youdao',
          opts.sourceLang,
          opts.targetLang,
          opts.mtSettings
        );
        if (mt.ok && mt.text?.trim()) {
          return {
            targetText: mt.text.trim(),
            status: SegmentStatus.PreTranslated,
            matchType: MatchType.MT,
            source: 'mt',
          };
        }
      } catch {
        /* continue to LLM if allowed */
      }
    }
    if (strategy === 'tmMt') return null;
  }

  if (strategy === 'llmOnly' || strategy === 'tmMtLlm' || strategy === 'tmLlm') {
    const text = await tryLlmTranslate(sourceText, opts);
    if (text?.trim()) {
      return {
        targetText: text.trim(),
        status: SegmentStatus.Translated,
        matchType: MatchType.AI,
        source: 'llm',
      };
    }
  }

  return null;
}

export type PreTranslateBatchStats = {
  tm: number;
  fuzzy: number;
  mt: number;
  llm: number;
  skipped: number;
  failed: number;
};

export async function runPreTranslateBatch(
  segments: Segment[],
  opts: PreTranslateOptions,
  onProgress?: (current: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ segments: Segment[]; stats: PreTranslateBatchStats }> {
  const stats: PreTranslateBatchStats = { tm: 0, fuzzy: 0, mt: 0, llm: 0, skipped: 0, failed: 0 };
  const targets = segments.filter((s) => !s.isLocked && !s.targetText?.trim());
  const updated = [...segments];
  const idToIdx = new Map(updated.map((s, i) => [s.id, i]));

  let current = 0;
  for (const seg of targets) {
    if (isCancelled?.()) break;
    const idx = idToIdx.get(seg.id);
    if (idx === undefined) continue;
    try {
      const ragContext = opts.buildRagContext
        ? await opts.buildRagContext(seg.sourceText)
        : opts.ragContext;
      const result = await preTranslateSegment(seg.sourceText, { ...opts, ragContext });
      if (!result) {
        stats.skipped += 1;
      } else {
        updated[idx] = {
          ...updated[idx],
          targetText: result.targetText,
          status: result.status,
          matchType: result.matchType,
          matchScore: result.matchScore,
        };
        stats[result.source === 'fuzzy' ? 'fuzzy' : result.source] += 1;
      }
    } catch {
      stats.failed += 1;
    }
    current += 1;
    onProgress?.(current, targets.length);
  }

  return { segments: updated, stats };
}

/** Build glossary pairs from term entries for a source sentence. */
export function glossaryFromTerms(sourceText: string, terms: TermBaseEntry[]): { source: string; target: string }[] {
  const lower = sourceText.toLowerCase();
  return terms
    .filter((e) => e.source.trim() && lower.includes(e.source.toLowerCase()))
    .map((e) => ({ source: e.source, target: e.target }));
}
