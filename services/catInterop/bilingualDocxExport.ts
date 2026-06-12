import JSZip from 'jszip';
import type { ProjectFile, Segment } from '../../types';
import { downloadBytes } from '../xliff/xliffExport';
import { buildFormattedParagraph, type WordFontSpec } from '../inlineFormatting/docxRunWrite';
import { buildInterleavedFromOriginalDocx } from './bilingualDocxInterleavedMerge';
import { loadSourceBlob } from './sourceBlobStore';
import {
  segmentTargetForBilingualExport,
  shouldSkipBilingualTargetExport,
  sourceFontForBilingualPair,
  targetFontForBilingualPair,
  type BilingualExportFontPair,
  type BilingualInterleavedOrder,
  type OriginalDocxExportMode,
} from './originalFormatExportTypes';

function buildParagraphFromSegment(
  text: string,
  inlineRunMeta: Segment['inlineRunMeta'],
  font: WordFontSpec
): string {
  return buildFormattedParagraph(text ?? '', inlineRunMeta, font);
}

function buildTableCellFromSegment(
  text: string,
  inlineRunMeta: Segment['inlineRunMeta'],
  font: WordFontSpec
): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="4677" w:type="dxa"/></w:tcPr>` +
    `${buildParagraphFromSegment(text, inlineRunMeta, font)}</w:tc>`
  );
}

function buildTableRowFromSegments(
  cells: Array<{ text: string; meta?: Segment['inlineRunMeta'] }>,
  fonts: WordFontSpec[]
): string {
  const cellXml = cells
    .map((cell, i) => buildTableCellFromSegment(cell.text, cell.meta, fonts[i] ?? fonts[0]))
    .join('');
  return `<w:tr>${cellXml}</w:tr>`;
}

function buildInterleavedBody(
  segments: Segment[],
  fontPair: BilingualExportFontPair,
  order: BilingualInterleavedOrder
): string {
  const sourceFont = sourceFontForBilingualPair(fontPair);
  const targetFont = targetFontForBilingualPair(fontPair);
  const parts: string[] = [];
  for (const seg of segments) {
    const sourcePara = buildParagraphFromSegment(seg.sourceText, seg.inlineRunMeta, sourceFont);
    const targetPara = shouldSkipBilingualTargetExport(seg)
      ? ''
      : buildParagraphFromSegment(
          segmentTargetForBilingualExport(seg),
          seg.inlineRunMeta,
          targetFont
        );

    if (order === 'target-first') {
      if (targetPara) parts.push(targetPara);
      parts.push(sourcePara);
    } else {
      parts.push(sourcePara);
      if (targetPara) parts.push(targetPara);
    }
  }
  return parts.join('');
}

function buildTableBody(segments: Segment[], fontPair: BilingualExportFontPair): string {
  const sourceFont = sourceFontForBilingualPair(fontPair);
  const targetFont = targetFontForBilingualPair(fontPair);
  const rows: string[] = [];
  rows.push(
    buildTableRowFromSegments(
      [
        { text: '原文', meta: undefined },
        { text: '译文', meta: undefined },
      ],
      [sourceFont, targetFont]
    )
  );
  for (const seg of segments) {
    const targetText = shouldSkipBilingualTargetExport(seg, 'table')
      ? ''
      : segmentTargetForBilingualExport(seg);
    rows.push(
      buildTableRowFromSegments(
        [
          { text: seg.sourceText, meta: seg.inlineRunMeta },
          { text: targetText, meta: seg.inlineRunMeta },
        ],
        [sourceFont, targetFont]
      )
    );
  }
  return (
    `<w:tbl>` +
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `</w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4677"/><w:gridCol w:w="4677"/></w:tblGrid>` +
    rows.join('') +
    `</w:tbl>`
  );
}

function buildDocumentXml(
  segments: Segment[],
  mode: OriginalDocxExportMode,
  fontPair: BilingualExportFontPair,
  interleavedOrder: BilingualInterleavedOrder
): string {
  const body =
    mode === 'table'
      ? buildTableBody(segments, fontPair)
      : buildInterleavedBody(segments, fontPair, interleavedOrder);
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>` +
  `<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:qFormat/></w:style></w:styles>`;

export async function buildBilingualDocxBytes(
  segments: Segment[],
  mode: Exclude<OriginalDocxExportMode, 'monolingual'>,
  fontPair: BilingualExportFontPair,
  file?: ProjectFile,
  interleavedOrder: BilingualInterleavedOrder = 'source-first'
): Promise<Uint8Array> {
  if (
    mode === 'interleaved' &&
    file?.sourceBlobId &&
    file.name.toLowerCase().endsWith('.docx')
  ) {
    const original = await loadSourceBlob(file.sourceBlobId);
    if (original) {
      return buildInterleavedFromOriginalDocx(original, segments, fontPair, interleavedOrder);
    }
  }

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.folder('_rels')!.file('.rels', ROOT_RELS_XML);
  zip.folder('word')!.file(
    'document.xml',
    buildDocumentXml(segments, mode, fontPair, interleavedOrder)
  );
  zip.folder('word')!.folder('_rels')!.file('document.xml.rels', DOCUMENT_RELS_XML);
  zip.folder('word')!.file('styles.xml', STYLES_XML);
  return zip.generateAsync({ type: 'uint8array' });
}

function exportSuffix(mode: Exclude<OriginalDocxExportMode, 'monolingual'>): string {
  return mode === 'table' ? '_并列对照' : '_段段对照';
}

function buildExportFileName(originalName: string, mode: Exclude<OriginalDocxExportMode, 'monolingual'>): string {
  const base = originalName.replace(/\.docx$/i, '');
  return `${base}${exportSuffix(mode)}.docx`;
}

function exportZipTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function exportBilingualDocxFile(
  file: ProjectFile,
  segments: Segment[],
  mode: Exclude<OriginalDocxExportMode, 'monolingual'>,
  fontPair: BilingualExportFontPair,
  interleavedOrder: BilingualInterleavedOrder = 'source-first'
): Promise<string> {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    throw new Error(`不支持双语 DOCX 导出：${file.name}`);
  }
  if (segments.length === 0) {
    throw new Error('没有可导出的句段');
  }
  const bytes = await buildBilingualDocxBytes(segments, mode, fontPair, file, interleavedOrder);
  const fileName = buildExportFileName(file.name, mode);
  downloadBytes(bytes, fileName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return fileName;
}

export async function exportBilingualDocxProjectZip(
  files: ProjectFile[],
  segmentsByFileId: Map<string, Segment[]>,
  mode: Exclude<OriginalDocxExportMode, 'monolingual'>,
  fontPair: BilingualExportFontPair,
  interleavedOrder: BilingualInterleavedOrder = 'source-first'
): Promise<string> {
  const zip = new JSZip();
  let count = 0;

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.docx')) continue;
    const segments = segmentsByFileId.get(file.id);
    if (!segments?.length) continue;
    const bytes = await buildBilingualDocxBytes(
      segments,
      mode,
      fontPair,
      file,
      interleavedOrder
    );
    zip.file(buildExportFileName(file.name, mode), bytes);
    count += 1;
  }

  if (count === 0) {
    throw new Error('没有可导出的 DOCX 文件或句段');
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipName = `项目双语导出_${exportZipTimestamp()}.zip`;
  downloadBytes(zipBytes, zipName, 'application/zip');
  return zipName;
}
