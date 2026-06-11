import { SegmentStatus } from '../types';

export const SEGMENT_STATUS_LABELS: Record<SegmentStatus, string> = {
  [SegmentStatus.NotStarted]: '未开始',
  [SegmentStatus.Draft]: '草稿',
  [SegmentStatus.Translated]: '已翻译',
  [SegmentStatus.PreTranslated]: '预翻译',
  [SegmentStatus.Confirmed]: '已确认',
  [SegmentStatus.Review]: '待审',
  [SegmentStatus.Proofread]: '已校对',
  [SegmentStatus.Approved]: '已批准',
  [SegmentStatus.Rejected]: '已拒绝',
};

/** SDL XLIFF export status slug */
export function segmentStatusToSdlSlug(status: SegmentStatus): string {
  switch (status) {
    case SegmentStatus.Confirmed:
    case SegmentStatus.Approved:
      return 'approved';
    case SegmentStatus.Proofread:
      return 'proofread';
    case SegmentStatus.PreTranslated:
      return 'pretranslated';
    case SegmentStatus.Rejected:
      return 'rejected';
    case SegmentStatus.Draft:
      return 'draft';
    case SegmentStatus.Translated:
    case SegmentStatus.Review:
      return 'translated';
    default:
      return 'translated';
  }
}
