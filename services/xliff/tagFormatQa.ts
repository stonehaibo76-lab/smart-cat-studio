import type { QAIssue, Segment } from '../../types';
import { segmentHasCopyableSourceFormat } from '../inlineFormatting/copySourceFormatting';
import { TAG_FORMAT_QA_MESSAGE, validateSdlMarkers } from './tagValidation';

export function shouldRunTagFormatQa(
  file: { interchangeFormat?: string },
  segment: Pick<Segment, 'sourceText' | 'inlineRunMeta'>
): boolean {
  if (file.interchangeFormat === 'sdlxliff') return true;
  return segmentHasCopyableSourceFormat(segment.sourceText, segment.inlineRunMeta);
}

/** Merge tag-format QA into existing issues (replaces prior `tags` category). */
export function withTagFormatQaIssues(
  segment: Pick<Segment, 'id' | 'sourceText' | 'inlineRunMeta' | 'qaIssues'>,
  file: { interchangeFormat?: string },
  targetText: string
): { qaIssues: QAIssue[] | undefined } {
  const existing = (segment.qaIssues ?? []).filter((i) => i.category !== 'tags');
  if (!shouldRunTagFormatQa(file, segment) || !targetText.trim()) {
    return { qaIssues: existing.length > 0 ? existing : undefined };
  }
  const tagCheck = validateSdlMarkers(segment.sourceText, targetText);
  if (!tagCheck.ok) {
    return {
      qaIssues: [
        ...existing,
        {
          id: `tag-${segment.id}`,
          type: 'warning',
          category: 'tags',
          message: TAG_FORMAT_QA_MESSAGE,
        },
      ],
    };
  }
  return { qaIssues: existing.length > 0 ? existing : undefined };
}

export function applyTagFormatQaToSegment(
  segment: Segment,
  file: { interchangeFormat?: string },
  targetText: string
): Segment {
  return {
    ...segment,
    targetText,
    ...withTagFormatQaIssues(segment, file, targetText),
  };
}
