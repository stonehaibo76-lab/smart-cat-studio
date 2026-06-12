import JSZip from 'jszip';
import mammoth from 'mammoth';
import type { InlineRunStyle } from '../../types';
import {
  extractTaggedParagraphsFromDocXml,
  extractTaggedTextFromCell,
  extractTaggedTextFromParagraph,
} from '../inlineFormatting/docxRunExtract';
import { stripInlineMarkers } from '../inlineFormatting/markerParse';

export interface BilingualDocxSegment {
  id: string;
  source: string;
  target: string;
  /** Paragraph / TU index for format-preserving merge (p-0, p-1, …) */
  okapiTuId?: string;
  inlineRunMeta?: InlineRunStyle[];
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** True when text looks like raw WordprocessingML instead of human-readable content. */
export function looksLikeWordXml(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^<w:[a-z]/i.test(t)) return true;
  return t.includes('<w:tc') || t.includes('<w:p ') || t.includes('<w:rPr');
}

function extractWordTextFromBlock(block: string): string {
  const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi;
  let parts = '';
  let tm: RegExpExecArray | null;
  while ((tm = tRe.exec(block)) !== null) {
    parts += decodeXml(tm[1]);
  }
  return parts.trim();
}

function taggedFromBlock(block: string): { text: string; inlineRunMeta: InlineRunStyle[] } {
  const fromPara = extractTaggedTextFromParagraph(block);
  if (fromPara) return fromPara;
  const plain = extractWordTextFromBlock(block);
  return { text: plain, inlineRunMeta: [] };
}

type TableLayout = {
  rowCount: number;
  allTwoColumn: boolean;
  hasBilingualHeader: boolean;
};

function analyzeTwoColumnTableLayout(xml: string): TableLayout {
  const rowRe = /<w:tr[\s>][\s\S]*?<\/w:tr>/gi;
  const cellRe = /<w:tc[\s>][\s\S]*?<\/w:tc>/gi;
  let rowCount = 0;
  let allTwoColumn = true;
  let firstRowTexts: string[] | null = null;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[0])) !== null) {
      cells.push(extractWordTextFromBlock(cm[0]));
    }
    if (cells.length === 0) continue;
    rowCount += 1;
    if (cells.length !== 2) allTwoColumn = false;
    if (!firstRowTexts) firstRowTexts = cells;
  }

  const hasBilingualHeader =
    !!firstRowTexts &&
    firstRowTexts.length >= 2 &&
    (firstRowTexts[0].toLowerCase() === 'source' || firstRowTexts[0] === '原文') &&
    (firstRowTexts[1].toLowerCase() === 'target' || firstRowTexts[1] === '译文');

  return { rowCount, allTwoColumn, hasBilingualHeader };
}

/** Extract Trados/memoQ-style 2-column table rows as source/target pairs. */
function extractTablePairs(xml: string): BilingualDocxSegment[] {
  const segments: BilingualDocxSegment[] = [];
  const rowRe = /<w:tr[\s>][\s\S]*?<\/w:tr>/gi;
  const cellRe = /<w:tc[\s>][\s\S]*?<\/w:tc>/gi;
  let rm: RegExpExecArray | null;
  let idx = 0;

  while ((rm = rowRe.exec(xml)) !== null) {
    const cellBlocks: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[0])) !== null) {
      cellBlocks.push(cm[0]);
    }
    if (cellBlocks.length !== 2) continue;

    const srcTagged = extractTaggedTextFromCell(cellBlocks[0]);
    const tgtTagged = extractTaggedTextFromCell(cellBlocks[1]);
    const cells = [
      srcTagged?.text ?? extractWordTextFromBlock(cellBlocks[0]),
      tgtTagged?.text ?? extractWordTextFromBlock(cellBlocks[1]),
    ];
    if (!cells[0] || !cells[1]) continue;
    if (looksLikeWordXml(cells[0]) || looksLikeWordXml(cells[1])) continue;

    const lower0 = cells[0].toLowerCase();
    const lower1 = cells[1].toLowerCase();
    if (
      idx === 0 &&
      (lower0 === 'source' || lower0 === '原文') &&
      (lower1 === 'target' || lower1 === '译文')
    ) {
      continue;
    }

    segments.push({
      id: `bdocx-${idx}`,
      source: cells[0],
      target: cells[1],
      okapiTuId: `p-${idx}`,
      inlineRunMeta: srcTagged?.inlineRunMeta ?? [],
    });
    idx += 1;
  }
  return segments;
}

function isCleanBilingualSegments(segments: BilingualDocxSegment[]): boolean {
  if (segments.length === 0) return false;
  return segments.every(
    (s) =>
      s.source.trim().length > 0 &&
      !looksLikeWordXml(s.source) &&
      !looksLikeWordXml(s.target)
  );
}

export type ParseBilingualDocxOptions = {
  /** Only pair alternating body paragraphs when filename hints bilingual DOCX. */
  allowAlternatingParas?: boolean;
};

export type DocxBilingualLayout = 'table' | 'interleaved';

export type ParseBilingualDocxResult = {
  segments: BilingualDocxSegment[];
  layout: DocxBilingualLayout;
};

/** Detect Trados-style bilingual DOCX (strict 2-column table or alternating paragraphs). */
export async function parseBilingualDocx(
  arrayBuffer: ArrayBuffer,
  options: ParseBilingualDocxOptions = {}
): Promise<ParseBilingualDocxResult | null> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return null;

  const layout = analyzeTwoColumnTableLayout(docXml);
  if (layout.rowCount >= 1 && (layout.allTwoColumn || layout.hasBilingualHeader)) {
    const fromTable = extractTablePairs(docXml);
    if (isCleanBilingualSegments(fromTable)) {
      return { segments: fromTable, layout: 'table' };
    }
  }

  if (!options.allowAlternatingParas) return null;

  const taggedParas = extractTaggedParagraphsFromDocXml(docXml);
  if (taggedParas.length < 2) return null;

  const segments: BilingualDocxSegment[] = [];
  for (let i = 0; i + 1 < taggedParas.length; i += 2) {
    segments.push({
      id: `bdocx-${i / 2}`,
      source: taggedParas[i].text,
      target: taggedParas[i + 1].text,
      okapiTuId: `p-${i / 2}`,
      inlineRunMeta: taggedParas[i].inlineRunMeta,
    });
  }
  return isCleanBilingualSegments(segments) ? { segments, layout: 'interleaved' } : null;
}

/** Monolingual DOCX: one segment per paragraph (fallback mammoth plain text). */
export async function parseMonolingualDocx(
  arrayBuffer: ArrayBuffer
): Promise<BilingualDocxSegment[]> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (docXml) {
    const taggedParas = extractTaggedParagraphsFromDocXml(docXml);
    if (taggedParas.length > 0) {
      return taggedParas.map((tp, i) => ({
        id: `docx-${i}`,
        source: tp.text,
        target: '',
        okapiTuId: `p-${i}`,
        inlineRunMeta: tp.inlineRunMeta,
      }));
    }
  }

  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !looksLikeWordXml(line))
    .map((source, i) => ({
      id: `docx-${i}`,
      source,
      target: '',
      okapiTuId: `p-${i}`,
    }));
}

export function isLikelyBilingualDocxFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.docx') && /bilingual|双语|for translation|待译|trados|memoq/i.test(name);
}

export async function parseDocxForImport(
  arrayBuffer: ArrayBuffer,
  fileName: string
): Promise<{
  segments: BilingualDocxSegment[];
  mode: 'bilingual' | 'monolingual';
  docxBilingualLayout?: DocxBilingualLayout;
}> {
  const nameHint = isLikelyBilingualDocxFileName(fileName);
  const bilingual = await parseBilingualDocx(arrayBuffer, {
    allowAlternatingParas: nameHint,
  });
  if (bilingual && bilingual.segments.length > 0) {
    return {
      segments: bilingual.segments,
      mode: 'bilingual',
      docxBilingualLayout: bilingual.layout,
    };
  }
  const monolingual = await parseMonolingualDocx(arrayBuffer);
  return { segments: monolingual, mode: 'monolingual' };
}

/** Visible plain text for word count / locking checks. */
export function visibleDocxSegmentText(text: string): string {
  return stripInlineMarkers(text).trim();
}
