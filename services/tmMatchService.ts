import type { TranslationMemory, TranslationMemoryUnit } from '../types';
import { normalizeForMatching, sourcesEqual } from '../utils/textNormalize';
import { searchTmMatchesApi } from './localBackendClient';

export type TmMatchHit = TranslationMemoryUnit & {
  score: number;
  sourceTM: string;
  tmId: string;
};

/** Levenshtein-based fuzzy score (0–100). */
export function calculateMatchScoreValue(source: string, target: string): number {
  if (!source || !target) return 0;
  if (sourcesEqual(source, target)) return 100;

  const a = normalizeForMatching(source).toLowerCase();
  const b = normalizeForMatching(target).toLowerCase();
  if (a === b) return 100;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLength = Math.max(a.length, b.length);
  return Math.max(0, Math.floor(((maxLength - distance) / maxLength) * 100));
}

export function searchTmMatchesInMemory(
  sourceText: string,
  tms: TranslationMemory[],
  minScore = 50,
  limit = 20
): TmMatchHit[] {
  if (!sourceText?.trim() || !tms.length) return [];

  const hits: TmMatchHit[] = [];
  for (const tm of tms) {
    for (const u of tm.units) {
      const score = calculateMatchScoreValue(sourceText, u.source);
      if (score >= minScore) {
        hits.push({ ...u, score, sourceTM: tm.name, tmId: tm.id });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function findExactTmMatch(
  sourceText: string,
  tms: TranslationMemory[]
): (TranslationMemoryUnit & { tmId: string; sourceTM: string }) | null {
  for (const tm of tms) {
    for (const u of tm.units) {
      if (sourcesEqual(sourceText, u.source)) {
        return { ...u, tmId: tm.id, sourceTM: tm.name };
      }
    }
  }
  return null;
}

const matchCache = new Map<string, { hits: TmMatchHit[]; ts: number }>();
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 200;

function cacheKey(sourceText: string, tmIds: string[], minScore: number): string {
  return `${normalizeForMatching(sourceText)}|${tmIds.sort().join(',')}|${minScore}`;
}

function trimCache() {
  if (matchCache.size <= CACHE_MAX) return;
  const entries = [...matchCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  for (let i = 0; i < entries.length - CACHE_MAX; i++) {
    matchCache.delete(entries[i][0]);
  }
}

export async function searchTmMatches(
  sourceText: string,
  tms: TranslationMemory[],
  minScore = 50,
  limit = 20
): Promise<TmMatchHit[]> {
  if (!sourceText?.trim() || !tms.length) return [];
  const tmIds = tms.map((t) => t.id);
  const key = cacheKey(sourceText, tmIds, minScore);
  const cached = matchCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.hits.slice(0, limit);
  }

  try {
    const apiHits = await searchTmMatchesApi({
      tmIds,
      sourceText,
      minScore,
      limit,
      tmNames: Object.fromEntries(tms.map((t) => [t.id, t.name])),
    });
    if (apiHits.length > 0 || tms.some((t) => t.units.length > 0)) {
      matchCache.set(key, { hits: apiHits, ts: Date.now() });
      trimCache();
      return apiHits;
    }
  } catch {
    /* fall back to in-memory */
  }

  const mem = searchTmMatchesInMemory(sourceText, tms, minScore, limit);
  matchCache.set(key, { hits: mem, ts: Date.now() });
  trimCache();
  return mem;
}

/** Prefetch matches for adjacent segments (idle optimization). */
export function prefetchTmMatches(
  segments: { id: string; sourceText: string }[],
  tms: TranslationMemory[],
  minScore = 50
): void {
  for (const seg of segments) {
    if (!seg.sourceText?.trim()) continue;
    void searchTmMatches(seg.sourceText, tms, minScore, 20);
  }
}

export function invalidateTmMatchCache(): void {
  matchCache.clear();
}
