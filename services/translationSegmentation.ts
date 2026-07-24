import type { TranslationSegmentationMode } from '../types';
import { stripInlineMarkers } from './inlineFormatting/markerParse';

export const DEFAULT_TRANSLATION_SEGMENTATION_MODE: TranslationSegmentationMode = 'sentence';

export function resolveSegmentationMode(
  mode?: TranslationSegmentationMode | null
): TranslationSegmentationMode {
  return mode === 'paragraph' ? 'paragraph' : 'sentence';
}

export function segmentationModeLabel(mode: TranslationSegmentationMode): string {
  return mode === 'paragraph' ? '按段翻译' : '按句翻译';
}

/** 按常见句末标点切分；无句末标点时整段视为一句 */
export function splitTextIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[。！？.!?…])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

/** 空行分段；若无空行则按非空行 */
export function splitPlainTextIntoParagraphs(content: string): string[] {
  const blocks = content
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.replace(/\r?\n+/g, ' ').trim())
    .filter(Boolean);
  if (blocks.length > 0) return blocks;
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function splitPlainTextToSources(
  content: string,
  mode: TranslationSegmentationMode
): string[] {
  const paragraphs = splitPlainTextIntoParagraphs(content);
  if (mode === 'paragraph') return paragraphs;
  return paragraphs.flatMap((p) => splitTextIntoSentences(p));
}

export type SegmentationExtractSegment = {
  id?: string;
  source: string;
  target?: string;
  okapiTuId?: string;
  okapiSegmentIndex?: number;
  inlineRunMeta?: import('../types').InlineRunStyle[];
};

/** 导入后按项目翻译模式调整 Okapi / 结构化句段列表 */
export function applySegmentationToExtractedSegments<T extends SegmentationExtractSegment>(
  segments: T[],
  mode: TranslationSegmentationMode
): T[] {
  const resolved = resolveSegmentationMode(mode);
  if (!segments.length) return segments;

  if (resolved === 'paragraph') {
    const groups = new Map<string, T[]>();
    segments.forEach((seg, index) => {
      const key = seg.okapiTuId?.trim() || seg.id?.trim() || `unit-${index}`;
      const list = groups.get(key) ?? [];
      list.push(seg);
      groups.set(key, list);
    });

    const out: T[] = [];
    let i = 0;
    for (const [, group] of groups) {
      group.sort((a, b) => (a.okapiSegmentIndex ?? 0) - (b.okapiSegmentIndex ?? 0));
      const mergedSource = group
        .map((s) => s.source.trim())
        .filter(Boolean)
        .join(' ');
      if (!mergedSource) continue;
      const mergedTarget = group
        .map((s) => s.target?.trim())
        .filter(Boolean)
        .join(' ');
      const first = group[0];
      out.push({
        ...first,
        source: mergedSource,
        target: mergedTarget || first.target || '',
        okapiTuId: first.okapiTuId ?? `p-${i}`,
        okapiSegmentIndex: 0,
      });
      i += 1;
    }
    return out;
  }

  const out: T[] = [];
  let unitIdx = 0;
  for (const seg of segments) {
    const plain = stripInlineMarkers(seg.source);
    const sentences = splitTextIntoSentences(plain);
    const tuId = seg.okapiTuId ?? `p-${unitIdx}`;

    if (sentences.length <= 1) {
      out.push({
        ...seg,
        okapiTuId: tuId,
        okapiSegmentIndex: seg.okapiSegmentIndex ?? 0,
      });
      unitIdx += 1;
      continue;
    }

    sentences.forEach((sent, si) => {
      out.push({
        ...seg,
        id: seg.id ? `${seg.id}-s${si}` : undefined,
        source: sent,
        target: si === 0 ? seg.target ?? '' : '',
        okapiTuId: tuId,
        okapiSegmentIndex: si,
        inlineRunMeta: si === 0 ? seg.inlineRunMeta : undefined,
      });
    });
    unitIdx += 1;
  }
  return out;
}
