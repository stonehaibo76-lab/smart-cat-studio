import JSZip from 'jszip';
import type { Segment } from '../../types';
import {
  applySourceFontsToDrawingmlParagraphBlock,
  applySourceFontsToWordParagraphBlock,
  buildFormattedDrawingmlParagraph,
  buildFormattedParagraph,
  type WordFontSpec,
} from '../inlineFormatting/docxRunWrite';
import {
  collectDocxTextUnits,
  isDocxTextUnitExportable,
  isDrawingmlInsideTxbxHost,
  resolveSourceParagraphStartInBlock,
  resolveTargetInsertionPosInBlock,
  type DocxTextUnit,
} from './docxTextUnits';
import type { BilingualExportFontPair, BilingualInterleavedOrder } from './originalFormatExportTypes';
import {
  segmentTargetForBilingualExport,
  shouldSkipBilingualTargetExport,
  sourceFontForBilingualPair,
  targetFontForBilingualPair,
} from './originalFormatExportTypes';

function segmentByTuId(segments: Segment[]): Map<string, Segment> {
  const map = new Map<string, Segment>();
  segments.forEach((seg, index) => {
    map.set(seg.okapiTuId ?? `p-${index}`, seg);
  });
  return map;
}

function buildTargetBlock(
  unit: DocxTextUnit,
  seg: Segment,
  targetFont: WordFontSpec
): string {
  const targetText = segmentTargetForBilingualExport(seg);
  if (unit.kind === 'drawingml') {
    return buildFormattedDrawingmlParagraph(targetText, seg.inlineRunMeta, targetFont);
  }
  return buildFormattedParagraph(targetText, seg.inlineRunMeta, targetFont);
}

function applySourceFontsToUnitBlock(block: string, unit: DocxTextUnit, sourceFont: WordFontSpec): string {
  return unit.kind === 'drawingml'
    ? applySourceFontsToDrawingmlParagraphBlock(block, sourceFont)
    : applySourceFontsToWordParagraphBlock(block, sourceFont);
}

function mergeInterleavedUnitBlock(
  styledBlock: string,
  targetXml: string,
  unit: DocxTextUnit,
  order: BilingualInterleavedOrder
): string {
  if (!targetXml) return styledBlock;

  const insertPos =
    order === 'source-first'
      ? resolveTargetInsertionPosInBlock(styledBlock, unit.kind)
      : resolveSourceParagraphStartInBlock(styledBlock, unit.kind);

  return styledBlock.slice(0, insertPos) + targetXml + styledBlock.slice(insertPos);
}

type WorkUnit = { unit: DocxTextUnit; tuId: string };

/** Insert target paragraphs after each exportable source unit, preserving original layout. */
export function insertInterleavedTargetsInDocumentXml(
  xml: string,
  segments: Segment[],
  fontPair: BilingualExportFontPair,
  order: BilingualInterleavedOrder = 'source-first'
): string {
  const sourceFont = sourceFontForBilingualPair(fontPair);
  const targetFont = targetFontForBilingualPair(fontPair);
  const segMap = segmentByTuId(segments);
  const units = collectDocxTextUnits(xml);
  const workUnits: WorkUnit[] = [];
  let unitIdx = 0;

  for (const unit of units) {
    if (!isDocxTextUnitExportable(xml, unit)) continue;
    const tuId = `p-${unitIdx}`;
    unitIdx += 1;
    if (unit.kind === 'drawingml' && isDrawingmlInsideTxbxHost(xml, unit, units)) {
      continue;
    }
    workUnits.push({ unit, tuId });
  }

  // Process from document end so earlier unit offsets stay valid after each edit.
  workUnits.sort((a, b) => b.unit.end - a.unit.end);

  let result = xml;
  for (const { unit, tuId } of workUnits) {
    const block = result.slice(unit.start, unit.end);
    const styledBlock = applySourceFontsToUnitBlock(block, unit, sourceFont);
    let mergedBlock = styledBlock;

    const seg = segMap.get(tuId);
    if (seg && !shouldSkipBilingualTargetExport(seg)) {
      mergedBlock = mergeInterleavedUnitBlock(
        styledBlock,
        buildTargetBlock(unit, seg, targetFont),
        unit,
        order
      );
    }

    if (mergedBlock !== block) {
      result = result.slice(0, unit.start) + mergedBlock + result.slice(unit.end);
    }
  }

  return result;
}

/** Build interleaved bilingual DOCX from original file bytes (preserves tables, TOC, text boxes). */
export async function buildInterleavedFromOriginalDocx(
  originalBytes: ArrayBuffer,
  segments: Segment[],
  fontPair: BilingualExportFontPair,
  order: BilingualInterleavedOrder = 'source-first'
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(originalBytes);
  const docPath = 'word/document.xml';
  const docXml = await zip.file(docPath)?.async('string');
  if (!docXml) {
    throw new Error('无法读取原始 DOCX 的 document.xml');
  }
  const merged = insertInterleavedTargetsInDocumentXml(docXml, segments, fontPair, order);
  zip.file(docPath, merged);
  return zip.generateAsync({ type: 'uint8array' });
}
