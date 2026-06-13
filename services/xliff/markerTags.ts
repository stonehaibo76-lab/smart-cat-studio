const TAG_ID = '[A-Za-z0-9_]+';
const PAIRED_TAG_RE = new RegExp(`<(${TAG_ID})>(.*?)</\\1>`, 'gs');
const STANDALONE_TAG_RE = new RegExp(`<(${TAG_ID})/>`, 'g');
const TAG_TOKEN_RE = new RegExp(`(<${TAG_ID}>|</${TAG_ID}>|<${TAG_ID}/>)`, 'g');

export function hasMarkerTags(text: string): boolean {
  return new RegExp(`<${TAG_ID}[>/]`).test(text);
}

/** Remove inline tag markers and return visible text for import filtering. */
export function stripMarkerTags(text: string): string {
  if (!text) return '';
  PAIRED_TAG_RE.lastIndex = 0;
  let t = text.replace(PAIRED_TAG_RE, (_m, _id: string, inner: string) => inner ?? '');
  STANDALONE_TAG_RE.lastIndex = 0;
  t = t.replace(STANDALONE_TAG_RE, '');
  return t.trim();
}

export function hasTranslatableContent(text: string): boolean {
  return stripMarkerTags(text).length > 0;
}

/** Supervertaler marker → SDLXLIFF inline XML in default namespace */
const SPLIT_TOKEN_RE = new RegExp(`(<${TAG_ID}>|</${TAG_ID}>|<${TAG_ID}/>)`);

export function markersToXml(text: string): string {
  if (!text) return text;

  const parts = text.split(SPLIT_TOKEN_RE);
  let result = '';
  for (const part of parts) {
    if (SPLIT_TOKEN_RE.test(part)) {
      SPLIT_TOKEN_RE.lastIndex = 0;
      result += part;
    } else if (part) {
      result += part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }

  if (!new RegExp(`<${TAG_ID}[>/]`).test(result)) return result;

  let prev = '';
  let cur = result;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(PAIRED_TAG_RE, '<g id="$1">$2</g>');
  }
  cur = cur.replace(STANDALONE_TAG_RE, '<x id="$1"/>');
  return cur;
}

export interface ParsedSdlSegment {
  segmentId: string;
  transUnitId: string;
  sourceText: string;
  targetText: string;
  status: string;
  matchPercent: number;
  origin: string;
  textMatch: string;
  locked: boolean;
  comments: string[];
}

/**
 * Trados Studio hides structural / locked placeholder rows that have no source text.
 * Import only segments that would appear in the translator grid.
 */
export function shouldImportSdlSegment(seg: ParsedSdlSegment): boolean {
  const src = hasTranslatableContent(seg.sourceText);
  const tgt = hasTranslatableContent(seg.targetText);
  if (!src && !tgt) return false;
  if (seg.locked && !src) return false;
  return true;
}
