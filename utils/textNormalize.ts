import { stripMarkerTags } from '../services/xliff/markerTags';

/** Billable source characters (strip inline tags; align with CAT 原文字数). */
export function countBillableChars(text: string): number {
  return stripMarkerTags(text).length;
}

/** Unicode / whitespace normalization for TM exact match (Supervertaler-style). */
export function normalizeForMatching(text: string): string {
  if (!text) return '';
  let t = text.normalize('NFC');
  t = t.replace(/\u00a0/g, ' ');
  t = t.replace(/\u2007/g, ' ');
  t = t.replace(/\u202f/g, ' ');
  t = t.replace(/\s+/g, ' ');
  return t.trim();
}

export function sourcesEqual(a: string, b: string): boolean {
  return normalizeForMatching(a) === normalizeForMatching(b);
}
