import type { InlineRunStyle } from '../../types';

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractRunTexts(rBlock: string): string {
  const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi;
  let parts = '';
  let m: RegExpExecArray | null;
  while ((m = tRe.exec(rBlock)) !== null) {
    parts += decodeXml(m[1]);
  }
  return parts;
}

function attrVal(block: string, tag: string): string | undefined {
  const re = new RegExp(`<w:${tag}(?:\\s[^>]*)?/>`, 'i');
  const openRe = new RegExp(`<w:${tag}(?:\\s[^>]*)?>`, 'i');
  const m = block.match(re) ?? block.match(openRe);
  if (!m) return undefined;
  const valM = m[0].match(/\bw:val="([^"]*)"/i);
  return valM ? valM[1] : '';
}

function isTruthy(val: string | undefined): boolean {
  if (val === undefined) return true;
  const v = val.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'none' && v !== 'off';
}

export function parseRunStyleFromRPr(rPrInner: string): InlineRunStyle | null {
  if (!rPrInner.trim()) return null;
  const style: InlineRunStyle = { id: '' };
  let has = false;

  if (/<w:b[\s/>]/i.test(rPrInner) && isTruthy(attrVal(rPrInner, 'b'))) {
    style.bold = true;
    has = true;
  }
  if (/<w:i[\s/>]/i.test(rPrInner) && isTruthy(attrVal(rPrInner, 'i'))) {
    style.italic = true;
    has = true;
  }
  if (/<w:u[\s/>]/i.test(rPrInner) && isTruthy(attrVal(rPrInner, 'u'))) {
    style.underline = true;
    has = true;
  }
  if ((/<w:strike[\s/>]/i.test(rPrInner) || /<w:dstrike[\s/>]/i.test(rPrInner)) && isTruthy(attrVal(rPrInner, 'strike') ?? attrVal(rPrInner, 'dstrike'))) {
    style.strike = true;
    has = true;
  }
  const colorVal = attrVal(rPrInner, 'color');
  if (colorVal && colorVal.toLowerCase() !== 'auto') {
    style.color = colorVal.toUpperCase();
    has = true;
  }
  const hl = attrVal(rPrInner, 'highlight');
  if (hl && hl.toLowerCase() !== 'none') {
    style.highlight = hl;
    has = true;
  }
  const vert = attrVal(rPrInner, 'vertAlign');
  if (vert === 'superscript' || vert === 'subscript') {
    style.vertAlign = vert;
    has = true;
  }

  return has ? style : null;
}

export function styleSignature(style: InlineRunStyle | null): string {
  if (!style) return '';
  const parts: string[] = [];
  if (style.bold) parts.push('b');
  if (style.italic) parts.push('i');
  if (style.underline) parts.push('u');
  if (style.strike) parts.push('s');
  if (style.color) parts.push(`c:${style.color}`);
  if (style.highlight) parts.push(`h:${style.highlight}`);
  if (style.vertAlign) parts.push(`v:${style.vertAlign}`);
  return parts.join('|');
}

export interface TaggedParagraph {
  text: string;
  inlineRunMeta: InlineRunStyle[];
}

function paragraphDefaultRPr(pBlock: string): string {
  const pprM = pBlock.match(/<w:pPr[^>]*>([\s\S]*?)<\/w:pPr>/i);
  if (!pprM) return '';
  const rprM = pprM[1].match(/<w:rPr[^>]*>([\s\S]*?)<\/w:rPr>/i);
  return rprM?.[1] ?? '';
}

function effectiveRunRPr(rBlock: string, defaultRPr: string): string {
  const rprM = rBlock.match(/<w:rPr[^>]*>([\s\S]*?)<\/w:rPr>/i);
  if (!rprM) return defaultRPr;
  const inner = rprM[1];
  if (!inner.trim() && defaultRPr) return defaultRPr;
  return inner;
}

/** Build marked source text + run meta from a Word paragraph XML block. */
export function extractTaggedTextFromParagraph(pBlock: string): TaggedParagraph | null {
  const defaultRPr = paragraphDefaultRPr(pBlock);
  const rRe = /<w:r[\s>][\s\S]*?<\/w:r>/gi;
  const runs: { text: string; style: InlineRunStyle | null }[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = rRe.exec(pBlock)) !== null) {
    const text = extractRunTexts(rm[0]);
    if (!text) continue;
    const style = parseRunStyleFromRPr(effectiveRunRPr(rm[0], defaultRPr));
    runs.push({ text, style });
  }
  if (runs.length === 0) return null;

  let nextId = 1;
  const meta: InlineRunStyle[] = [];
  let out = '';

  for (const run of runs) {
    // Tag any run with explicit w:rPr formatting (not only runs that differ from the first).
    // Otherwise whole-paragraph styles (e.g. strikethrough-only segment) lose tags and WYSIWYG.
    if (run.style) {
      const id = String(nextId++);
      meta.push({ ...run.style, id });
      out += `<${id}>${run.text}</${id}>`;
    } else {
      out += run.text;
    }
  }

  const trimmed = out.trim();
  if (!trimmed) return null;
  return { text: trimmed, inlineRunMeta: meta };
}

/** Extract plain text (no tags) from paragraph block — fallback. */
export function extractPlainTextFromParagraph(pBlock: string): string {
  const tagged = extractTaggedTextFromParagraph(pBlock);
  if (tagged) {
    return tagged.text.replace(/<\/?[A-Za-z0-9_]+>/g, '').replace(/<[A-Za-z0-9_]+\/>/g, '');
  }
  return '';
}

function dropStrictlyNestedSpans(spans: Array<[number, number]>): Array<[number, number]> {
  return spans.filter(([s, e]) =>
    !spans.some(
      ([s2, e2]) => (s2 !== s || e2 !== e) && s2 <= s && e <= e2 && (s2 < s || e < e2)
    )
  );
}

function findAllWpBlockSpans(xml: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const openRe = /<w:p[\s>]/gi;
  const closeRe = /<\/w:p>/gi;
  let i = 0;
  while (i < xml.length) {
    openRe.lastIndex = i;
    const om = openRe.exec(xml);
    if (!om) break;
    const start = om.index;
    let depth = 1;
    let pos = om.index + om[0].length;
    while (pos < xml.length && depth > 0) {
      openRe.lastIndex = pos;
      closeRe.lastIndex = pos;
      const om2 = openRe.exec(xml);
      const cm = closeRe.exec(xml);
      if (!cm) break;
      if (om2 && om2.index < cm.index) {
        depth += 1;
        pos = om2.index + om2[0].length;
      } else {
        depth -= 1;
        pos = cm.index + cm[0].length;
        if (depth === 0) spans.push([start, pos]);
      }
    }
    i = start + 1;
  }
  return dropStrictlyNestedSpans(spans);
}

function extractDrawingmlParagraphText(aPBlock: string): string | null {
  const tRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let parts = '';
  let m: RegExpExecArray | null;
  while ((m = tRe.exec(aPBlock)) !== null) {
    parts += decodeXml(m[1]);
  }
  const text = parts.trim();
  return text || null;
}

function findAllDrawingmlParagraphSpans(xml: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const openRe = /<a:p\b[\s>]/gi;
  const closeRe = /<\/a:p>/gi;
  let i = 0;
  while (i < xml.length) {
    openRe.lastIndex = i;
    const om = openRe.exec(xml);
    if (!om) break;
    const start = om.index;
    let depth = 1;
    let pos = om.index + om[0].length;
    while (pos < xml.length && depth > 0) {
      openRe.lastIndex = pos;
      closeRe.lastIndex = pos;
      const om2 = openRe.exec(xml);
      const cm = closeRe.exec(xml);
      if (!cm) break;
      if (om2 && om2.index < cm.index) {
        depth += 1;
        pos = om2.index + om2[0].length;
      } else {
        depth -= 1;
        pos = cm.index + cm[0].length;
        if (depth === 0) spans.push([start, pos]);
      }
    }
    i = start + 1;
  }
  return dropStrictlyNestedSpans(spans);
}

/** Extract tagged paragraphs from document.xml body (incl. text boxes & shape text). */
export function extractTaggedParagraphsFromDocXml(xml: string): TaggedParagraph[] {
  const units: Array<{ kind: 'wp' | 'drawingml'; start: number; end: number }> = [];
  for (const [start, end] of findAllWpBlockSpans(xml)) {
    units.push({ kind: 'wp', start, end });
  }
  for (const [start, end] of findAllDrawingmlParagraphSpans(xml)) {
    units.push({ kind: 'drawingml', start, end });
  }
  units.sort((a, b) => a.start - b.start);

  const results: TaggedParagraph[] = [];
  for (const unit of units) {
    const block = xml.slice(unit.start, unit.end);
    if (unit.kind === 'wp') {
      const tagged = extractTaggedTextFromParagraph(block);
      if (tagged?.text) results.push(tagged);
    } else {
      const text = extractDrawingmlParagraphText(block);
      if (text) results.push({ text, inlineRunMeta: [] });
    }
  }
  return results;
}

/** First paragraph in a table cell block. */
export function extractTaggedTextFromCell(cellBlock: string): TaggedParagraph | null {
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/i;
  const pm = cellBlock.match(pRe);
  if (!pm) return null;
  return extractTaggedTextFromParagraph(pm[0]);
}
