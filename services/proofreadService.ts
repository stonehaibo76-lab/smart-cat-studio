import { SegmentStatus, type AISettings, type QAIssue, type Segment } from '../types';
import { runDeepQACheck } from './geminiService';
import { withAiConcurrency } from './aiConcurrency';

export type ProofreadResult = {
  segmentId: string;
  issues: QAIssue[];
  comment?: string;
  ok: boolean;
};

export type ProofreadBatchStats = {
  processed: number;
  withIssues: number;
  failed: number;
};

export async function proofreadSegment(
  segment: Segment,
  sourceLang: string,
  targetLang: string,
  aiSettings: AISettings,
  contextDescription?: string
): Promise<ProofreadResult> {
  if (!segment.targetText?.trim()) {
    return { segmentId: segment.id, issues: [], ok: true };
  }

  try {
    const checks = [
      '语义是否准确',
      '术语是否一致',
      '语法与标点',
      contextDescription ? `项目背景: ${contextDescription}` : '',
    ].filter(Boolean);
    const issues = await withAiConcurrency(() =>
      runDeepQACheck(
        segment.sourceText,
        segment.targetText,
        targetLang,
        checks,
        aiSettings
      )
    );
    const comment =
      issues.length > 0
        ? issues.map((i) => `[${i.category}] ${i.message}`).join('\n')
        : undefined;
    return {
      segmentId: segment.id,
      issues,
      comment,
      ok: issues.filter((i) => i.type === 'error').length === 0,
    };
  } catch (e) {
    return {
      segmentId: segment.id,
      issues: [
        {
          id: `pr-err-${Date.now()}`,
          type: 'error',
          category: '校对',
          message: String(e instanceof Error ? e.message : e),
        },
      ],
      ok: false,
    };
  }
}

export async function runProofreadBatch(
  segments: Segment[],
  sourceLang: string,
  targetLang: string,
  aiSettings: AISettings,
  options?: {
    contextDescription?: string;
    onlyWithTarget?: boolean;
    setProofreadStatus?: boolean;
    onProgress?: (current: number, total: number) => void;
    isCancelled?: () => boolean;
  }
): Promise<{ segments: Segment[]; stats: ProofreadBatchStats }> {
  const onlyWithTarget = options?.onlyWithTarget !== false;
  const targets = segments.filter(
    (s) => !s.isLocked && (!onlyWithTarget || s.targetText?.trim())
  );
  const updated = [...segments];
  const idToIdx = new Map(updated.map((s, i) => [s.id, i]));
  const stats: ProofreadBatchStats = { processed: 0, withIssues: 0, failed: 0 };

  let current = 0;
  for (const seg of targets) {
    if (options?.isCancelled?.()) break;
    const idx = idToIdx.get(seg.id);
    if (idx === undefined) continue;

    const result = await proofreadSegment(
      seg,
      sourceLang,
      targetLang,
      aiSettings,
      options?.contextDescription
    );
    stats.processed += 1;
    if (!result.ok && result.issues.some((i) => i.category === '校对')) {
      stats.failed += 1;
    } else if (result.issues.length > 0) {
      stats.withIssues += 1;
    }

    const comments = [...(updated[idx].comments ?? [])];
    if (result.comment) {
      comments.push(`[校对] ${result.comment}`);
    }

    updated[idx] = {
      ...updated[idx],
      qaIssues: [...(updated[idx].qaIssues ?? []), ...result.issues],
      comments,
      status:
        options?.setProofreadStatus && result.ok
          ? SegmentStatus.Proofread
          : updated[idx].status,
    };

    current += 1;
    options?.onProgress?.(current, targets.length);
  }

  return { segments: updated, stats };
}
