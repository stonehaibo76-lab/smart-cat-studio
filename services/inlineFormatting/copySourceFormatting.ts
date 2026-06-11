import type { InlineRunStyle } from '../../types';
import { hasMarkerTags } from '../xliff/markerTags';
import {
  applyTagToPlainRange,
  buildMarkedString,
  hasInlineMarkers,
  parseMarkedParts,
  stripInlineMarkers,
  type MarkedPart,
} from './markerParse';

export interface CopyFormattingResult {
  targetText: string;
  inlineRunMeta: InlineRunStyle[];
}

export function segmentHasCopyableSourceFormat(
  sourceText: string,
  inlineRunMeta?: InlineRunStyle[]
): boolean {
  return (inlineRunMeta?.length ?? 0) > 0 || hasMarkerTags(sourceText) || hasInlineMarkers(sourceText);
}

function proportionalSplit(text: string, weights: number[]): string[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [text];
  if (!text) return weights.map(() => '');
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const slices: string[] = [];
  let pos = 0;
  for (let i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) {
      slices.push(text.slice(pos));
    } else {
      const len = Math.floor((text.length * weights[i]) / totalWeight);
      slices.push(text.slice(pos, pos + len));
      pos += len;
    }
  }
  return slices;
}

/** Map raw marker-string selection to visible (tag-stripped) offsets. */
export function markerSelectionToPlainOffsets(
  text: string,
  start: number,
  end: number
): { start: number; end: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const plainStart = stripInlineMarkers(text.slice(0, s)).length;
  const plainEnd = plainStart + stripInlineMarkers(text.slice(s, e)).length;
  return { start: plainStart, end: plainEnd };
}

/** Apply source tag structure to target; split target text proportionally by source part lengths. */
export function copySourceFormattingToTarget(
  sourceText: string,
  targetText: string,
  sourceMeta: InlineRunStyle[] | undefined
): CopyFormattingResult {
  const sourceParts = parseMarkedParts(sourceText);
  const plainTarget = stripInlineMarkers(targetText);

  if (sourceParts.length === 0 || !plainTarget) {
    return {
      targetText: plainTarget || targetText,
      inlineRunMeta: sourceMeta ? sourceMeta.map((m) => ({ ...m })) : [],
    };
  }

  const weights = sourceParts.map((p) => {
    if (p.type === 'plain') return p.text.length || 1;
    if (p.type === 'tagged') return p.text.length || 1;
    return 1;
  });
  const slices = proportionalSplit(plainTarget, weights);

  const outParts: MarkedPart[] = sourceParts.map((p, i) => {
    const slice = slices[i] ?? '';
    if (p.type === 'plain') return { type: 'plain', text: slice };
    if (p.type === 'tagged') return { type: 'tagged', id: p.id, text: slice };
    return p;
  });

  return {
    targetText: buildMarkedString(outParts),
    inlineRunMeta: sourceMeta ? sourceMeta.map((m) => ({ ...m })) : [],
  };
}

/**
 * Apply source inline structure to target (whole or plain-text selection).
 * Selection uses visible character offsets (tags excluded).
 */
export function applySourceFormattingToTarget(
  sourceText: string,
  targetText: string,
  sourceMeta: InlineRunStyle[] | undefined,
  plainSelection?: { start: number; end: number } | null
): CopyFormattingResult {
  const plain = stripInlineMarkers(targetText);
  const metaCopy = sourceMeta ? sourceMeta.map((m) => ({ ...m })) : [];

  if (!segmentHasCopyableSourceFormat(sourceText, sourceMeta)) {
    return { targetText, inlineRunMeta: metaCopy };
  }

  let beforePlain = '';
  let workPlain = plain;
  let afterPlain = '';

  if (plainSelection && plainSelection.start < plainSelection.end) {
    const s = Math.max(0, Math.min(plainSelection.start, plain.length));
    const e = Math.max(s, Math.min(plainSelection.end, plain.length));
    beforePlain = plain.slice(0, s);
    workPlain = plain.slice(s, e);
    afterPlain = plain.slice(e);
  }

  if (!workPlain) {
    return { targetText, inlineRunMeta: metaCopy };
  }

  const formatted = copySourceFormattingToTarget(sourceText, workPlain, sourceMeta);
  return {
    targetText: beforePlain + formatted.targetText + afterPlain,
    inlineRunMeta: formatted.inlineRunMeta,
  };
}

/** Apply a single source run style to the plain-text selection in target. */
export function applyRunStyleToTargetSelection(
  targetText: string,
  plainSelection: { start: number; end: number },
  runStyle: InlineRunStyle,
  existingMeta?: InlineRunStyle[]
): CopyFormattingResult {
  const plain = stripInlineMarkers(targetText);
  const s = Math.max(0, Math.min(plainSelection.start, plain.length));
  const e = Math.max(s, Math.min(plainSelection.end, plain.length));
  if (s >= e) {
    return {
      targetText,
      inlineRunMeta: existingMeta ? existingMeta.map((m) => ({ ...m })) : [],
    };
  }

  const runId = runStyle.id;
  const newTarget = applyTagToPlainRange(targetText, { start: s, end: e }, runId);

  const meta = existingMeta ? existingMeta.map((m) => ({ ...m })) : [];
  const entry = { ...runStyle, id: runId };
  const idx = meta.findIndex((m) => m.id === runId);
  if (idx >= 0) meta[idx] = entry;
  else meta.push(entry);

  return {
    targetText: newTarget,
    inlineRunMeta: meta,
  };
}
