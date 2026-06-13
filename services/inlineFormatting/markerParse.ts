import type { InlineRunStyle } from '../../types';

const TAG_ID = '[A-Za-z0-9_]+';
const PAIRED_TAG_RE = new RegExp(`<(${TAG_ID})>(.*?)</\\1>`, 'gs');
const STANDALONE_TAG_RE = new RegExp(`<(${TAG_ID})/>`, 'g');

export type MarkedPart =
  | { type: 'plain'; text: string }
  | { type: 'tagged'; id: string; text: string }
  | { type: 'standalone'; id: string };

export function hasInlineMarkers(text: string): boolean {
  return new RegExp(`<${TAG_ID}[>/]`).test(text);
}

export function stripInlineMarkers(text: string): string {
  if (!text) return '';
  PAIRED_TAG_RE.lastIndex = 0;
  let t = text.replace(PAIRED_TAG_RE, (_m, _id: string, inner: string) => inner ?? '');
  STANDALONE_TAG_RE.lastIndex = 0;
  t = t.replace(STANDALONE_TAG_RE, '');
  return t;
}

/** Split marked string into ordered plain/tagged parts. */
export function parseMarkedParts(text: string): MarkedPart[] {
  if (!text) return [];
  const parts: MarkedPart[] = [];
  const re = new RegExp(`(<(${TAG_ID})>(.*?)</\\2>|<(${TAG_ID})/>)`, 'gs');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'plain', text: text.slice(last, m.index) });
    }
    if (m[2] !== undefined) {
      parts.push({ type: 'tagged', id: m[2], text: m[3] ?? '' });
    } else if (m[4] !== undefined) {
      parts.push({ type: 'standalone', id: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'plain', text: text.slice(last) });
  }
  return parts;
}

export function buildMarkedString(parts: MarkedPart[]): string {
  return mergeAdjacentParts(parts)
    .map((p) => {
      if (p.type === 'plain') return p.text;
      if (p.type === 'tagged') return `<${p.id}>${p.text}</${p.id}>`;
      return `<${p.id}/>`;
    })
    .join('');
}

function mergeAdjacentParts(parts: MarkedPart[]): MarkedPart[] {
  const merged: MarkedPart[] = [];
  for (const p of parts) {
    if (p.type === 'plain' && !p.text) continue;
    if (p.type === 'tagged' && !p.text) continue;
    const last = merged[merged.length - 1];
    if (p.type === 'tagged' && last?.type === 'tagged' && last.id === p.id) {
      last.text += p.text;
    } else if (p.type === 'plain' && last?.type === 'plain') {
      last.text += p.text;
    } else if (p.type === 'standalone') {
      merged.push({ ...p });
    } else if (p.type === 'tagged') {
      merged.push({ type: 'tagged', id: p.id, text: p.text });
    } else {
      merged.push({ type: 'plain', text: p.text });
    }
  }
  return merged;
}

/** Apply run tag to a plain-text range while preserving existing tags outside the range. */
export function applyTagToPlainRange(
  targetText: string,
  plainSelection: { start: number; end: number },
  runId: string
): string {
  const s = Math.max(0, plainSelection.start);
  const e = Math.max(s, plainSelection.end);
  if (s >= e) return targetText;

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

    if (before) {
      out.push(
        part.type === 'tagged'
          ? { type: 'tagged', id: part.id, text: before }
          : { type: 'plain', text: before }
      );
    }
    if (middle) {
      out.push({ type: 'tagged', id: runId, text: middle });
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

/** Map tag id → style for rendering. */
export function metaById(meta: InlineRunStyle[] | undefined): Map<string, InlineRunStyle> {
  const map = new Map<string, InlineRunStyle>();
  for (const m of meta ?? []) {
    if (m.id) map.set(m.id, m);
  }
  return map;
}

export function highlightColorCss(wordHighlight: string | undefined): string | undefined {
  if (!wordHighlight) return undefined;
  const map: Record<string, string> = {
    yellow: '#FFFF00',
    green: '#00FF00',
    cyan: '#00FFFF',
    magenta: '#FF00FF',
    blue: '#0000FF',
    red: '#FF0000',
    darkBlue: '#000080',
    darkCyan: '#008080',
    darkGreen: '#008000',
    darkMagenta: '#800080',
    darkRed: '#800000',
    darkYellow: '#808000',
    lightGray: '#D3D3D3',
    darkGray: '#808080',
    black: '#000000',
    white: '#FFFFFF',
  };
  return map[wordHighlight] ?? map[wordHighlight.toLowerCase()] ?? '#FFFF00';
}

export function colorCss(wordColor: string | undefined): string | undefined {
  if (!wordColor) return undefined;
  const c = wordColor.replace(/^#/, '');
  if (/^[0-9A-Fa-f]{6}$/.test(c)) return `#${c}`;
  return undefined;
}
