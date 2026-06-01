import { MatchType, Project, ProjectFile, Segment, SegmentStatus } from '../types';

/** 与编辑器对照列状态一致：显式已确认，或锁定 + 有译文 + 100% 匹配视为已确认（用于筛选与进度） */
export function segmentIsEffectivelyConfirmed(seg: Segment): boolean {
  return (
    seg.status === SegmentStatus.Confirmed ||
    (Boolean(seg.isLocked) &&
      Boolean(seg.targetText?.trim()) &&
      seg.matchType === MatchType.Exact)
  );
}

export function recomputeFileProgressFields(file: ProjectFile): ProjectFile {
  const total = file.segments.length;
  const completed = file.segments.filter(segmentIsEffectivelyConfirmed).length;
  return {
    ...file,
    totalSegments: total,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function recomputeProjectProgressFields(project: Project): Project {
  const files = project.files.map(recomputeFileProgressFields);
  const totalSegments = files.reduce((acc, f) => acc + f.totalSegments, 0);
  const totalConfirmed = files.reduce(
    (acc, f) => acc + f.segments.filter(segmentIsEffectivelyConfirmed).length,
    0
  );
  return {
    ...project,
    files,
    totalSegments,
    progress: totalSegments > 0 ? Math.round((totalConfirmed / totalSegments) * 100) : 0,
  };
}
