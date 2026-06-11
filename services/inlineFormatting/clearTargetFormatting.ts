import type { InlineRunStyle } from '../../types';
import { stripScriptFormatting } from '../targetScriptFormat';
import {
  buildMarkedString,
  parseMarkedParts,
  stripInlineMarkers,
  type MarkedPart,
} from './markerParse';

export function clearAllTargetFormatting(text: string): string {
  return stripScriptFormatting(stripInlineMarkers(text || ''));
}

/** Remove inline tags and script formatting within a plain-text range; preserve tags outside. */
export function clearFormattingInPlainRange(
  targetText: string,
  plainSelection: { start: number; end: number }
): string {
  const plain = stripInlineMarkers(targetText || '');
  const s = Math.max(0, Math.min(plainSelection.start, plain.length));
  const e = Math.max(s, Math.min(plainSelection.end, plain.length));
  if (s >= e) return targetText || '';

  const parts = parseMarkedParts(targetText || '');
  const normalized =
    parts.length > 0 ? parts : [{ type: 'plain' as const, text: targetText || '' }];

  let pos = 0;
  const out: MarkedPart[] = [];

  for (const part of normalized) {
    if (part.type === 'standalone') {
      out.push(part);
      continue;
    }

    const text = part.text;
    const partStart = pos;
    const partEnd = pos + text.length;
    pos = partEnd;

    if (partEnd <= s || partStart >= e) {
      out.push(part);
      continue;
    }

    const localStart = Math.max(0, s - partStart);
    const localEnd = Math.min(text.length, e - partStart);
    const before = text.slice(0, localStart);
    const middle = stripScriptFormatting(text.slice(localStart, localEnd));
    const after = text.slice(localEnd);

    if (before) {
      out.push(
        part.type === 'tagged'
          ? { type: 'tagged', id: part.id, text: before }
          : { type: 'plain', text: before }
      );
    }
    if (middle) {
      out.push({ type: 'plain', text: middle });
    }
    if (after) {
      out.push(
        part.type === 'tagged'
          ? { type: 'tagged', id: part.id, text: after }
          : { type: 'plain', text: after }
      );
    }
  }

  return buildMarkedString(out);
}

/** Drop orphan meta entries; keep styles still referenced in source or target. */
export function pruneInlineRunMeta(
  targetText: string,
  sourceText: string,
  meta?: InlineRunStyle[]
): InlineRunStyle[] | undefined {
  if (!meta?.length) return undefined;
  const kept = meta.filter(
    (m) =>
      m.id &&
      (sourceText.includes(`<${m.id}>`) || targetText.includes(`<${m.id}>`))
  );
  return kept.length > 0 ? kept : undefined;
}
