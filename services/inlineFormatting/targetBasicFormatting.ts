import type { InlineRunStyle } from '../../types';
import {
  applyRunStyleToTargetSelection,
  type CopyFormattingResult,
} from './copySourceFormatting';
import {
  buildMarkedString,
  parseMarkedParts,
  type MarkedPart,
} from './markerParse';

export type BasicRunStyleKey = 'bold' | 'italic' | 'underline';

function metaMap(meta?: InlineRunStyle[]): Map<string, InlineRunStyle> {
  return new Map((meta ?? []).map((m) => [m.id, { ...m }]));
}

function runStyleHasFormatting(style: InlineRunStyle): boolean {
  return Boolean(
    style.bold ||
      style.italic ||
      style.underline ||
      style.strike ||
      style.color ||
      style.highlight ||
      style.vertAlign
  );
}

function newRunId(styleKey: BasicRunStyleKey): string {
  return `fmt-${styleKey}-${Date.now().toString(36).slice(2, 9)}`;
}

/** True when every visible character in [start,end) sits in a tagged run with styleKey enabled. */
export function selectionHasUniformBasicStyle(
  targetText: string,
  plainSelection: { start: number; end: number },
  styleKey: BasicRunStyleKey,
  existingMeta?: InlineRunStyle[]
): boolean {
  const s = Math.max(0, plainSelection.start);
  const e = Math.max(s, plainSelection.end);
  if (s >= e) return false;

  const meta = metaMap(existingMeta);
  const parts = parseMarkedParts(targetText || '');
  const normalized =
    parts.length > 0 ? parts : [{ type: 'plain' as const, text: targetText || '' }];

  let pos = 0;
  for (const part of normalized) {
    if (part.type === 'standalone') continue;
    const text = part.text;
    const partStart = pos;
    const partEnd = pos + text.length;
    pos = partEnd;

    if (partEnd <= s || partStart >= e) continue;

    const localStart = Math.max(0, s - partStart);
    const localEnd = Math.min(text.length, e - partStart);
    if (localEnd <= localStart) continue;

    if (part.type === 'plain') return false;

    const style = meta.get(part.id);
    if (!style?.[styleKey]) return false;
  }

  return true;
}

/** Remove one basic style flag inside plain-text range; unwrap runs that become unstyled. */
export function removeBasicStyleFromPlainRange(
  targetText: string,
  plainSelection: { start: number; end: number },
  styleKey: BasicRunStyleKey,
  existingMeta?: InlineRunStyle[]
): CopyFormattingResult {
  const s = Math.max(0, plainSelection.start);
  const e = Math.max(s, plainSelection.end);
  if (s >= e) {
    return {
      targetText,
      inlineRunMeta: existingMeta ? existingMeta.map((m) => ({ ...m })) : [],
    };
  }

  const meta = metaMap(existingMeta);
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
    const middle = text.slice(localStart, localEnd);
    const after = text.slice(localEnd);

    const pushTagged = (chunk: string, id: string) => {
      if (!chunk) return;
      out.push({ type: 'tagged', id, text: chunk });
    };
    const pushPlain = (chunk: string) => {
      if (!chunk) return;
      out.push({ type: 'plain', text: chunk });
    };

    if (part.type === 'plain') {
      pushPlain(before);
      pushPlain(middle);
      pushPlain(after);
      continue;
    }

    if (part.type === 'tagged') {
      const style = meta.get(part.id) ?? { id: part.id };
      const fullPartSelected = localStart === 0 && localEnd === text.length;

      if (before) pushTagged(before, part.id);

      if (middle) {
        const cleared: InlineRunStyle = { ...style, id: part.id };
        delete cleared[styleKey];
        if (runStyleHasFormatting(cleared)) {
          const midId = fullPartSelected ? part.id : newRunId(styleKey);
          pushTagged(middle, midId);
          meta.set(midId, { ...cleared, id: midId });
        } else {
          pushPlain(middle);
          if (fullPartSelected) meta.delete(part.id);
        }
      }

      if (after) pushTagged(after, part.id);
      continue;
    }
  }

  const inlineRunMeta = [...meta.values()].filter((m) => runStyleHasFormatting(m));

  return {
    targetText: buildMarkedString(out),
    inlineRunMeta,
  };
}

export function toggleBasicStyleOnTargetSelection(
  targetText: string,
  plainSelection: { start: number; end: number },
  styleKey: BasicRunStyleKey,
  existingMeta?: InlineRunStyle[]
): CopyFormattingResult {
  const s = Math.max(0, plainSelection.start);
  const e = Math.max(s, plainSelection.end);
  if (s >= e) {
    return {
      targetText,
      inlineRunMeta: existingMeta ? existingMeta.map((m) => ({ ...m })) : [],
    };
  }

  if (
    selectionHasUniformBasicStyle(targetText, { start: s, end: e }, styleKey, existingMeta)
  ) {
    return removeBasicStyleFromPlainRange(targetText, { start: s, end: e }, styleKey, existingMeta);
  }

  const runId = newRunId(styleKey);
  const style: InlineRunStyle = { id: runId, [styleKey]: true };
  return applyRunStyleToTargetSelection(targetText, { start: s, end: e }, style, existingMeta);
}
