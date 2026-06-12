import type { InlineRunStyle } from '../../types';
import { metaById, parseMarkedParts } from './markerParse';

export type WordFontSpec = {
  ascii: string;
  hAnsi: string;
  eastAsia: string;
  cs: string;
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function styleKey(style: InlineRunStyle | null | undefined): string {
  if (!style) return '';
  return [
    style.bold ? 'b' : '',
    style.italic ? 'i' : '',
    style.underline ? 'u' : '',
    style.strike ? 's' : '',
    style.color ?? '',
    style.highlight ?? '',
    style.vertAlign ?? '',
  ].join('|');
}

export function buildRFontsXml(font: WordFontSpec): string {
  return (
    `<w:rFonts w:ascii="${font.ascii}" w:hAnsi="${font.hAnsi}" ` +
    `w:eastAsia="${font.eastAsia}" w:cs="${font.cs}"/>`
  );
}

/** Build w:rPr inner XML from inline style + base font. */
export function buildRPrXml(style: InlineRunStyle | null | undefined, font: WordFontSpec): string {
  const parts: string[] = [buildRFontsXml(font)];
  if (style?.bold) parts.push('<w:b/>');
  if (style?.italic) parts.push('<w:i/>');
  if (style?.underline) parts.push('<w:u w:val="single"/>');
  if (style?.strike) parts.push('<w:strike/>');
  if (style?.color) {
    const c = style.color.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(c)) parts.push(`<w:color w:val="${c}"/>`);
  }
  if (style?.highlight) parts.push(`<w:highlight w:val="${style.highlight}"/>`);
  if (style?.vertAlign === 'superscript') parts.push('<w:vertAlign w:val="superscript"/>');
  if (style?.vertAlign === 'subscript') parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.join('');
}

export function buildFormattedRun(
  text: string,
  style: InlineRunStyle | null | undefined,
  font: WordFontSpec
): string {
  const body = escapeXml(text);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return (
    `<w:r><w:rPr>${buildRPrXml(style, font)}</w:rPr>` +
    `<w:t${preserve}>${body}</w:t></w:r>`
  );
}

type RunChunk = { text: string; style: InlineRunStyle | null };

/** Strip leaked inline markers and Word special spacing chars that show as ° with ¶ on. */
function normalizeRunText(text: string): string {
  return text
    .replace(/<[A-Za-z0-9_]+\/>/g, '')
    .replace(/<\/?[A-Za-z0-9_]+>/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00AD/g, '');
}

function chunksFromMarkedText(
  text: string,
  inlineRunMeta: InlineRunStyle[] | undefined
): RunChunk[] {
  if (!text) return [{ text: '', style: null }];
  const metaMap = metaById(inlineRunMeta);
  const parts = parseMarkedParts(text);
  if (parts.length === 0) return [{ text: normalizeRunText(text), style: null }];

  const chunks: RunChunk[] = [];
  for (const part of parts) {
    if (part.type === 'standalone') continue;
    const chunkText = normalizeRunText(part.text);
    if (!chunkText) continue;
    const style = part.type === 'tagged' ? metaMap.get(part.id) ?? null : null;
    const last = chunks[chunks.length - 1];
    if (last && styleKey(last.style) === styleKey(style)) {
      last.text += chunkText;
    } else {
      chunks.push({ text: chunkText, style });
    }
  }
  return chunks.length > 0 ? chunks : [{ text: '', style: null }];
}

/** Build a Word paragraph from marked segment text + inline run meta. */
export function buildFormattedParagraph(
  text: string,
  inlineRunMeta: InlineRunStyle[] | undefined,
  font: WordFontSpec
): string {
  const chunks = chunksFromMarkedText(text, inlineRunMeta);
  const runs = chunks.map((c) => buildFormattedRun(c.text, c.style, font)).join('');
  return `<w:p>${runs}</w:p>`;
}

function buildDrawingmlRPrXml(style: InlineRunStyle | null | undefined, font: WordFontSpec): string {
  const parts: string[] = [
    `<a:latin typeface="${font.ascii}"/>`,
    `<a:ea typeface="${font.eastAsia}"/>`,
    `<a:cs typeface="${font.cs}"/>`,
  ];
  if (style?.bold) parts.push('<a:b/>');
  if (style?.italic) parts.push('<a:i/>');
  if (style?.underline) parts.push('<a:u/>');
  if (style?.strike) parts.push('<a:strike/>');
  if (style?.color) {
    const c = style.color.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(c)) parts.push(`<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`);
  }
  if (style?.vertAlign === 'superscript') parts.push('<a:baseline val="30000"/>');
  if (style?.vertAlign === 'subscript') parts.push('<a:baseline val="-25000"/>');
  return parts.join('');
}

function buildDrawingmlFormattedRun(
  text: string,
  style: InlineRunStyle | null | undefined,
  font: WordFontSpec
): string {
  const body = escapeXml(text);
  return (
    `<a:r><a:rPr>${buildDrawingmlRPrXml(style, font)}</a:rPr>` +
    `<a:t>${body}</a:t></a:r>`
  );
}

/** Build a DrawingML paragraph for text-box translations. */
export function buildFormattedDrawingmlParagraph(
  text: string,
  inlineRunMeta: InlineRunStyle[] | undefined,
  font: WordFontSpec
): string {
  const chunks = chunksFromMarkedText(text, inlineRunMeta);
  const runs = chunks.map((c) => buildDrawingmlFormattedRun(c.text, c.style, font)).join('');
  return `<a:p>${runs || buildDrawingmlFormattedRun('', null, font)}</a:p>`;
}

function injectRFontsIntoRPrInner(inner: string, rfonts: string): string {
  const cleaned = inner.replace(/<w:rFonts\b[^>]*\/>/gi, '');
  return rfonts + cleaned;
}

/** Apply 中英混排 rFonts to an existing Word run (latin + eastAsia). */
export function applySourceFontsToWordRun(rBlock: string, font: WordFontSpec): string {
  const rfonts = buildRFontsXml(font);
  const scMatch = rBlock.match(/<w:rPr\b[^>]*\/>/i);
  if (scMatch && scMatch.index !== undefined) {
    return (
      rBlock.slice(0, scMatch.index) +
      `<w:rPr>${rfonts}</w:rPr>` +
      rBlock.slice(scMatch.index + scMatch[0].length)
    );
  }
  const rprMatch = rBlock.match(/(<w:rPr[^>]*>)([\s\S]*?)(<\/w:rPr>)/i);
  if (rprMatch && rprMatch.index !== undefined) {
    const inner = injectRFontsIntoRPrInner(rprMatch[2], rfonts);
    return (
      rBlock.slice(0, rprMatch.index) +
      rprMatch[1] +
      inner +
      rprMatch[3] +
      rBlock.slice(rprMatch.index + rprMatch[0].length)
    );
  }
  const openMatch = rBlock.match(/(<w:r(?:\s[^>]*)?>)/i);
  if (!openMatch || openMatch.index === undefined) return rBlock;
  return (
    openMatch[1] +
    `<w:rPr>${rfonts}</w:rPr>` +
    rBlock.slice(openMatch.index + openMatch[0].length)
  );
}

/** Rewrite rFonts on all text runs in a preserved source paragraph/table cell. */
export function applySourceFontsToWordParagraphBlock(block: string, font: WordFontSpec): string {
  const rRe = /<w:r[\s>][\s\S]*?<\/w:r>/gi;
  return block.replace(rRe, (rBlock) => {
    if (!/<w:t[\s>]/i.test(rBlock)) return rBlock;
    return applySourceFontsToWordRun(rBlock, font);
  });
}

function drawingmlFaceXml(font: WordFontSpec): string {
  return (
    `<a:latin typeface="${font.ascii}"/>` +
    `<a:ea typeface="${font.eastAsia}"/>` +
    `<a:cs typeface="${font.cs}"/>`
  );
}

function applySourceFontsToDrawingmlRun(rBlock: string, font: WordFontSpec): string {
  if (!/<a:t[\s>]/i.test(rBlock)) return rBlock;
  const faces = drawingmlFaceXml(font);
  const rprMatch = rBlock.match(/(<a:rPr\b[^>]*>)([\s\S]*?)(<\/a:rPr>)/i);
  if (rprMatch && rprMatch.index !== undefined) {
    let inner = rprMatch[2].replace(/<a:(?:latin|ea|cs)\b[^>]*\/>/gi, '');
    return (
      rBlock.slice(0, rprMatch.index) +
      rprMatch[1] +
      faces +
      inner +
      rprMatch[3] +
      rBlock.slice(rprMatch.index + rprMatch[0].length)
    );
  }
  const scMatch = rBlock.match(/<a:rPr\b[^>]*\/>/i);
  if (scMatch && scMatch.index !== undefined) {
    return (
      rBlock.slice(0, scMatch.index) +
      `<a:rPr>${faces}</a:rPr>` +
      rBlock.slice(scMatch.index + scMatch[0].length)
    );
  }
  const openMatch = rBlock.match(/(<a:r\b[^>]*>)/i);
  if (!openMatch || openMatch.index === undefined) return rBlock;
  return (
    rBlock.slice(0, openMatch.index) +
    openMatch[1] +
    `<a:rPr>${faces}</a:rPr>` +
    rBlock.slice(openMatch.index + openMatch[0].length)
  );
}

export function applySourceFontsToDrawingmlParagraphBlock(block: string, font: WordFontSpec): string {
  const rRe = /<a:r\b[\s\S]*?<\/a:r>/gi;
  return block.replace(rRe, (rBlock) => applySourceFontsToDrawingmlRun(rBlock, font));
}
