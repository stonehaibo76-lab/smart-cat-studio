import type { Segment } from '../types';
import { segmentTextForOriginalExport } from './catInterop/originalFormatExportTypes';

/** Strip tags that crash Okapi OpenXML merge (Supervertaler parity). */
export function sanitizeTranslationForOkapi(text: string): string {
  return text
    .replace(/<\/?(?:bi|li-[bo]|li)>/gi, '')
    .replace(/<\/?run\d+>/gi, '');
}

export type JavaMergeTranslation = {
  id: string;
  segmentIndex: number;
  translation: string;
};

/**
 * Group SRX sub-segments by Okapi TU id, concat translations, emit one merge entry per TU.
 * Mirrors Supervertaler `_try_okapi_merge_export`.
 */
export function buildJavaMergeTranslations(segments: Segment[]): JavaMergeTranslation[] {
  const tuGroups = new Map<string, Array<{ segIdx: number; translation: string }>>();

  for (const seg of segments) {
    const tuId = seg.okapiTuId?.trim();
    const segIdx = seg.okapiSegmentIndex;
    if (!tuId || segIdx == null || segIdx < 0) continue;

    const raw =
      seg.targetText?.trim() ||
      segmentTextForOriginalExport(seg) ||
      seg.sourceText?.trim() ||
      '';
    const translation = sanitizeTranslationForOkapi(raw);
    const list = tuGroups.get(tuId) ?? [];
    list.push({ segIdx, translation });
    tuGroups.set(tuId, list);
  }

  const translations: JavaMergeTranslation[] = [];
  for (const [tuId, subSegs] of tuGroups) {
    subSegs.sort((a, b) => a.segIdx - b.segIdx);
    const combined = sanitizeTranslationForOkapi(
      subSegs.map((s) => s.translation).join(' ')
    );
    translations.push({ id: tuId, segmentIndex: 0, translation: combined });
  }
  return translations;
}

export function isJavaOfficeOkapiFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.pptx') || lower.endsWith('.xlsx');
}

/** @deprecated Use isJavaOfficeOkapiFile */
export function isXlsxOkapiFile(fileName: string): boolean {
  return isJavaOfficeOkapiFile(fileName);
}

export type NormalizedOkapiExtractSegment = {
  id: string;
  source: string;
  target?: string;
  okapiTuId: string;
  okapiSegmentIndex: number;
};

/** Normalize Java sidecar ExtractResult.segments for Smart-CAT. */
export function normalizeJavaExtractSegments(
  rawSegments: Array<Record<string, unknown>> | undefined
): NormalizedOkapiExtractSegment[] {
  if (!Array.isArray(rawSegments)) return [];

  const out: NormalizedOkapiExtractSegment[] = [];
  for (const seg of rawSegments) {
    const tuId = String(seg.id ?? '').trim();
    const segmentIndex = Number(seg.segmentIndex ?? 0);
    const subDoc = String(seg.subDocument ?? '').toLowerCase();
    const plain = String(seg.source ?? '').trim();
    const tagged = String(seg.sourceWithTags ?? '').trim();
    const display = tagged || plain;

    if (subDoc.startsWith('header') || subDoc.startsWith('footer')) continue;
    if (!display) continue;

    out.push({
      id: `${tuId}__${segmentIndex}`,
      source: display,
      target: '',
      okapiTuId: tuId,
      okapiSegmentIndex: Number.isFinite(segmentIndex) ? segmentIndex : 0,
    });
  }
  return out;
}
