import { extractTaggedTextFromParagraph } from '../inlineFormatting/docxRunExtract';

export type DocxTextUnitKind = 'wp' | 'drawingml';

export type DocxTextUnit = {
  kind: DocxTextUnitKind;
  start: number;
  end: number;
};

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function dropStrictlyNestedSpans(spans: Array<[number, number]>): Array<[number, number]> {
  return spans.filter(
    ([s, e]) =>
      !spans.some(
        ([s2, e2]) => (s2 !== s || e2 !== e) && s2 <= s && e <= e2 && (s2 < s || e < e2)
      )
  );
}

function findAllBlockSpans(xml: string, openRe: RegExp, closeRe: RegExp): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
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

function findAllWpBlockSpans(xml: string): Array<[number, number]> {
  return findAllBlockSpans(xml, /<w:p[\s>]/gi, /<\/w:p>/gi);
}

function findAllDrawingmlParagraphSpans(xml: string): Array<[number, number]> {
  return findAllBlockSpans(xml, /<a:p\b[\s>]/gi, /<\/a:p>/gi);
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

/** Document-order exportable text units (Word paragraphs + DrawingML shape text). */
export function collectDocxTextUnits(xml: string): DocxTextUnit[] {
  const units: Array<{ kind: DocxTextUnitKind; start: number; end: number; order: number }> = [];
  for (const [start, end] of findAllWpBlockSpans(xml)) {
    units.push({ kind: 'wp', start, end, order: start });
  }
  for (const [start, end] of findAllDrawingmlParagraphSpans(xml)) {
    units.push({ kind: 'drawingml', start, end, order: start });
  }
  units.sort((a, b) => a.order - b.order);
  return units.map(({ kind, start, end }) => ({ kind, start, end }));
}

export function isDocxTextUnitExportable(xml: string, unit: DocxTextUnit): boolean {
  const block = xml.slice(unit.start, unit.end);
  if (unit.kind === 'wp') {
    const tagged = extractTaggedTextFromParagraph(block);
    return !!tagged?.text?.trim();
  }
  return extractDrawingmlParagraphText(block) !== null;
}

export function applyXmlInsertionsFromEnd(
  xml: string,
  insertions: Array<{ pos: number; text: string }>
): string {
  const sorted = [...insertions].sort((a, b) => b.pos - a.pos);
  let out = xml;
  for (const { pos, text } of sorted) {
    out = out.slice(0, pos) + text + out.slice(pos);
  }
  return out;
}

export function applyXmlReplacementsFromEnd(
  xml: string,
  replacements: Array<{ start: number; end: number; text: string }>
): string {
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let out = xml;
  for (const { start, end, text } of sorted) {
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

/** True when DrawingML paragraph sits inside a Word txbxContent host already handled as wp. */
export function isDrawingmlInsideTxbxHost(
  xml: string,
  unit: DocxTextUnit,
  allUnits: DocxTextUnit[]
): boolean {
  if (unit.kind !== 'drawingml') return false;
  return allUnits.some(
    (host) =>
      host.kind === 'wp' &&
      host.start < unit.start &&
      unit.end <= host.end &&
      /<w:txbxContent\b/i.test(xml.slice(host.start, host.end)) &&
      isDocxTextUnitExportable(xml, host)
  );
}

/**
 * Where to insert the target paragraph inside a unit block (relative offset).
 * Text-box anchors must receive inner w:p inside w:txbxContent, not after the outer w:p.
 */
function findTxbxLastParagraphSpan(block: string): { start: number; end: number } | null {
  const txbxOpenMatch = block.match(/<w:txbxContent\b[^>]*>/i);
  if (!txbxOpenMatch || txbxOpenMatch.index === undefined) return null;

  const txbxOpenEnd = txbxOpenMatch.index + txbxOpenMatch[0].length;
  const txbxCloseRel = block.indexOf('</w:txbxContent>', txbxOpenEnd);
  if (txbxCloseRel < 0) return null;

  const inner = block.slice(txbxOpenEnd, txbxCloseRel);
  const lastParaOpen = inner.lastIndexOf('<w:p');
  if (lastParaOpen < 0) return null;

  const lastParaClose = inner.indexOf('</w:p>', lastParaOpen);
  if (lastParaClose < 0) {
    return { start: txbxOpenEnd + lastParaOpen, end: txbxCloseRel };
  }

  return {
    start: txbxOpenEnd + lastParaOpen,
    end: txbxOpenEnd + lastParaClose + '</w:p>'.length,
  };
}

export function resolveTargetInsertionPosInBlock(block: string, kind: DocxTextUnitKind): number {
  if (kind !== 'wp') return block.length;

  const para = findTxbxLastParagraphSpan(block);
  if (para) return para.end;

  return block.length;
}

/** Relative offset to insert content before the source paragraph inside a unit block. */
export function resolveSourceParagraphStartInBlock(block: string, kind: DocxTextUnitKind): number {
  if (kind !== 'wp') return 0;

  const para = findTxbxLastParagraphSpan(block);
  if (para) return para.start;

  return 0;
}

export function resolveTargetInsertionPos(xml: string, unit: DocxTextUnit): number {
  const block = xml.slice(unit.start, unit.end);
  return unit.start + resolveTargetInsertionPosInBlock(block, unit.kind);
}
