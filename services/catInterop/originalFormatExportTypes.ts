import type { Segment } from '../../types';
import { stripInlineMarkers } from '../inlineFormatting/markerParse';
import type { WordFontSpec } from '../inlineFormatting/docxRunWrite';

/** 单语原文格式导出可选字体 */
export type MonolingualExportFont = 'simsun' | 'times-new-roman' | 'arial';

/** 双语 DOCX 导出字体组合：原文宋体 + 译文西文字体 */
export type BilingualExportFontPair = 'simsun-times-new-roman' | 'simsun-arial';

/** 段段对照：原文与译文的上下顺序 */
export type BilingualInterleavedOrder = 'source-first' | 'target-first';

/** 原文格式 DOCX 导出子模式（仿云译客 iCAT） */
export type OriginalDocxExportMode = 'monolingual' | 'interleaved' | 'table';

export const MONOLINGUAL_EXPORT_FONT_OPTIONS: {
  id: MonolingualExportFont;
  label: string;
  previewFamily: string;
}[] = [
  { id: 'simsun', label: '宋体', previewFamily: 'SimSun, 宋体, serif' },
  { id: 'times-new-roman', label: 'Times New Roman', previewFamily: '"Times New Roman", Times, serif' },
  { id: 'arial', label: 'Arial', previewFamily: 'Arial, sans-serif' },
];

export const BILINGUAL_EXPORT_FONT_OPTIONS: {
  id: BilingualExportFontPair;
  label: string;
  previewFamily: string;
}[] = [
  {
    id: 'simsun-times-new-roman',
    label: '宋体 + Times New Roman',
    previewFamily: 'SimSun, "Times New Roman", serif',
  },
  {
    id: 'simsun-arial',
    label: '宋体 + Arial',
    previewFamily: 'SimSun, Arial, sans-serif',
  },
];

export const DEFAULT_MONOLINGUAL_EXPORT_FONT: MonolingualExportFont = 'simsun';

/** PPTX 保真导出：译文字号相对原文的缩放比例 */
export const PPTX_FONT_SCALE_MIN = 0.1;
export const PPTX_FONT_SCALE_MAX = 1;
export const PPTX_FONT_SCALE_STEP = 0.05;
export const DEFAULT_PPTX_FONT_SCALE = 0.7;

export function clampPptxFontScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PPTX_FONT_SCALE;
  const clamped = Math.min(PPTX_FONT_SCALE_MAX, Math.max(PPTX_FONT_SCALE_MIN, value));
  return Math.round(clamped * 100) / 100;
}
export const DEFAULT_BILINGUAL_EXPORT_FONT: BilingualExportFontPair = 'simsun-times-new-roman';
export const DEFAULT_BILINGUAL_INTERLEAVED_ORDER: BilingualInterleavedOrder = 'source-first';

export const BILINGUAL_INTERLEAVED_ORDER_OPTIONS: {
  id: BilingualInterleavedOrder;
  label: string;
}[] = [
  { id: 'source-first', label: '原文在上，译文在下' },
  { id: 'target-first', label: '译文在上，原文在下' },
];

/** 原文混排：中文 eastAsia=宋体，拉丁字母/数字 ascii/hAnsi=西文字体 */
export function sourceFontForBilingualPair(pair: BilingualExportFontPair): WordFontSpec {
  const latin = pair === 'simsun-arial' ? 'Arial' : 'Times New Roman';
  return {
    ascii: latin,
    hAnsi: latin,
    eastAsia: '宋体',
    cs: latin,
  };
}

/** 译文段落字体（通常全段西文） */
export function targetFontForBilingualPair(pair: BilingualExportFontPair): WordFontSpec {
  const latin = pair === 'simsun-arial' ? 'Arial' : 'Times New Roman';
  return {
    ascii: latin,
    hAnsi: latin,
    eastAsia: latin,
    cs: latin,
  };
}

export type OriginalFormatKind = 'docx' | 'txt' | 'html' | 'pptx';

export function supportsOriginalFormatExport(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.docx') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm') ||
    lower.endsWith('.pptx')
  );
}

export function supportsDocxBilingualExport(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.docx');
}

export function getOriginalFormatKind(fileName: string): OriginalFormatKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.pptx')) return 'pptx';
  return null;
}

/** Primary format in export scope (single kind, or mixed when project has several). */
export function resolvePrimaryOriginalFormatKind(
  files: Array<{ name: string }>
): OriginalFormatKind | 'mixed' | null {
  const kinds = new Set<OriginalFormatKind>();
  for (const f of files) {
    const k = getOriginalFormatKind(f.name);
    if (k) kinds.add(k);
  }
  if (kinds.size === 0) return null;
  if (kinds.size === 1) return [...kinds][0];
  return 'mixed';
}

export function monolingualExportStyleLabel(kind: OriginalFormatKind | 'mixed' | null): string {
  switch (kind) {
    case 'pptx':
      return '纯译文（保真 PowerPoint 版式）';
    case 'docx':
      return '纯译文（保真 Word 版式）';
    case 'html':
      return '纯译文（保真 HTML 版式）';
    case 'txt':
      return '纯译文（保真文本）';
    case 'mixed':
      return '纯译文（保真原文格式）';
    default:
      return '纯译文（保真原文格式）';
  }
}

export function monolingualExportStyleHint(kind: OriginalFormatKind | 'mixed' | null): string {
  switch (kind) {
    case 'pptx':
      return '在原 PPTX 上写回译文，保留幻灯片版式与字符样式。';
    case 'docx':
      return '在原 DOCX 上写回译文，保留版式与字符样式。';
    case 'html':
      return '在原 HTML 上写回译文，保留页面结构与字符样式。';
    case 'txt':
      return '在原 TXT 上按行写回译文。';
    case 'mixed':
      return '在原 DOCX / PPTX / TXT / HTML 上写回译文，保留版式与字符样式。';
    default:
      return '在原文件上写回译文，保留版式与字符样式。';
  }
}

export function monolingualExportFontHint(kind: OriginalFormatKind | 'mixed' | null): string {
  switch (kind) {
    case 'pptx':
      return '将统一应用于导出文件中的译文文字（PowerPoint / Word / HTML）。纯文本 .txt 不受字体设置影响。';
    case 'docx':
      return '将统一应用于导出文件中的译文文字（Word / HTML）。纯文本 .txt 不受字体设置影响。';
    case 'html':
      return '将统一应用于导出文件中的译文文字（HTML / Word）。纯文本 .txt 不受字体设置影响。';
    case 'txt':
      return '纯文本 .txt 导出不受字体设置影响。';
    case 'mixed':
      return '将统一应用于导出文件中的译文文字（Word / PowerPoint / HTML）。纯文本 .txt 不受字体设置影响。';
    default:
      return '将统一应用于导出文件中的译文文字。纯文本 .txt 不受字体设置影响。';
  }
}

/** Text written into monolingual export: prefer translation, fall back to source. */
export function segmentTextForOriginalExport(seg: Segment): string {
  const target = seg.targetText?.trim() ?? '';
  if (target) return seg.targetText;
  return seg.sourceText ?? '';
}

/** Target column for bilingual export: empty if not translated. */
export function segmentTargetForBilingualExport(seg: Segment): string {
  return seg.targetText ?? '';
}

function visibleBilingualText(text: string): string {
  return stripInlineMarkers(text ?? '').trim();
}

/** True when target is empty, or (interleaved) when target matches source. */
export function shouldSkipBilingualTargetExport(
  seg: Segment,
  mode: 'interleaved' | 'table' = 'interleaved'
): boolean {
  const target = visibleBilingualText(segmentTargetForBilingualExport(seg));
  if (!target) return true;
  if (mode === 'table') return false;
  return visibleBilingualText(seg.sourceText ?? '') === target;
}

export function inferDefaultOriginalDocxMode(file: {
  name: string;
  docxImportMode?: 'bilingual' | 'monolingual';
  docxBilingualLayout?: 'table' | 'interleaved';
}): OriginalDocxExportMode {
  if (file.docxImportMode === 'bilingual' && file.docxBilingualLayout) {
    return file.docxBilingualLayout;
  }
  return 'interleaved';
}
