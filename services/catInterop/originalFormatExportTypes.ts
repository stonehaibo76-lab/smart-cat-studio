import type { Segment } from '../../types';

/** 单语原文格式导出可选字体（双语组合见 BilingualExportFontPair，后续实现） */
export type MonolingualExportFont = 'simsun' | 'times-new-roman' | 'arial';

/** 双语导出字体组合（后续实现） */
export type BilingualExportFontPair = 'simsun-times-new-roman' | 'simsun-arial';

export const MONOLINGUAL_EXPORT_FONT_OPTIONS: {
  id: MonolingualExportFont;
  label: string;
  previewFamily: string;
}[] = [
  { id: 'simsun', label: '宋体', previewFamily: 'SimSun, 宋体, serif' },
  { id: 'times-new-roman', label: 'Times New Roman', previewFamily: '"Times New Roman", Times, serif' },
  { id: 'arial', label: 'Arial', previewFamily: 'Arial, sans-serif' },
];

export const DEFAULT_MONOLINGUAL_EXPORT_FONT: MonolingualExportFont = 'simsun';

export type OriginalFormatKind = 'docx' | 'txt' | 'html';

export function supportsOriginalFormatExport(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.docx') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm')
  );
}

export function getOriginalFormatKind(fileName: string): OriginalFormatKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return null;
}

/** Text written into the exported file: prefer translation, fall back to source. */
export function segmentTextForOriginalExport(seg: Segment): string {
  const target = seg.targetText?.trim() ?? '';
  if (target) return seg.targetText;
  return seg.sourceText ?? '';
}
