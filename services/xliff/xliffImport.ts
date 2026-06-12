import type { InterchangeFormat, ProjectFile, Segment } from '../../types';
import { SegmentStatus, MatchType } from '../../types';
import { shouldAutoLockSegmentAtImport } from '../segmentAutoLock';
import { parseSdlxliffXml } from './sdlxliffParser';
import { parseMqxliffXml } from './mqxliffHandler';
import { parseTradosPackageBuffer } from './tradosPackageHandler';
import { parseMemoqPackageBuffer } from './memoqPackageHandler';
import { newXliffBlobId, saveXliffBlob, bytesToUtf8 } from './xliffBlobStore';

export interface ParsedXliffSegment {
  source: string;
  target: string;
  xliffSegmentId: string;
  transUnitId?: string;
  mqIndex?: number;
  status: SegmentStatus;
  matchType: MatchType;
  matchScore?: number;
  isLocked?: boolean;
  comments?: string[];
  sdlConf?: string;
  sdlOrigin?: string;
}

export interface ParsedXliffFile {
  fileName: string;
  format: InterchangeFormat;
  sourceLang: string;
  targetLang: string;
  originalBlobId: string;
  packagePath?: string;
  segments: ParsedXliffSegment[];
}

export interface ParsedXliffProject {
  sourceLang: string;
  targetLang: string;
  files: ParsedXliffFile[];
  tradosPackage?: import('../../types').TradosPackageMeta;
  memoqPackage?: import('../../types').MemoQPackageMeta;
  extraBlobIds?: string[];
}

function sdlStatusToSegment(status: string, hasTarget: boolean): SegmentStatus {
  switch (status) {
    case 'approved':
      return SegmentStatus.Confirmed;
    case 'translated':
    case 'draft':
      return hasTarget ? SegmentStatus.Translated : SegmentStatus.Draft;
    default:
      return hasTarget ? SegmentStatus.Draft : SegmentStatus.NotStarted;
  }
}

function sdlMatchType(percent: number, textMatch: string, origin: string): MatchType {
  if (textMatch === 'SourceAndTarget') return MatchType.CM;
  if (percent >= 100) return MatchType.Exact;
  if (percent >= 70) return MatchType.Fuzzy;
  if (origin === 'mt') return MatchType.MT;
  return MatchType.None;
}

function mqStatusToSegment(status: string): SegmentStatus {
  if (status === 'confirmed') return SegmentStatus.Confirmed;
  if (status === 'draft' || status === 'pre_translated') return SegmentStatus.Translated;
  return SegmentStatus.NotStarted;
}

export async function parseXliffFile(file: File): Promise<ParsedXliffProject> {
  const buf = await file.arrayBuffer();
  const blobId = newXliffBlobId();
  await saveXliffBlob(blobId, buf);
  const text = bytesToUtf8(buf);
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.mqxliff') || (lower.endsWith('.xliff') && text.includes('MQXliff'))) {
    const parsed = parseMqxliffXml(text);
    const segments: ParsedXliffSegment[] = parsed.segments.map((s, i) => ({
      source: s.source,
      target: s.target,
      xliffSegmentId: s.id,
      mqIndex: i,
      status: mqStatusToSegment(s.status),
      matchType: s.matchPercent && s.matchPercent >= 100 ? MatchType.Exact : s.matchPercent && s.matchPercent >= 70 ? MatchType.Fuzzy : MatchType.None,
      matchScore: s.matchPercent ?? undefined,
    }));
    return {
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
      files: [
        {
          fileName: file.name,
          format: 'mqxliff',
          sourceLang: parsed.sourceLang,
          targetLang: parsed.targetLang,
          originalBlobId: blobId,
          segments,
        },
      ],
    };
  }

  const parsed = parseSdlxliffXml(text);
  const segments: ParsedXliffSegment[] = parsed.segments.map((s) => ({
    source: s.sourceText,
    target: s.targetText,
    xliffSegmentId: s.segmentId,
    transUnitId: s.transUnitId,
    status: sdlStatusToSegment(s.status, Boolean(s.targetText.trim())),
    matchType: sdlMatchType(s.matchPercent, s.textMatch, s.origin),
    matchScore: s.matchPercent || undefined,
    isLocked: s.locked,
    comments: s.comments.length ? s.comments : undefined,
    sdlConf: s.status,
    sdlOrigin: s.origin,
  }));

  return {
    sourceLang: parsed.sourceLang,
    targetLang: parsed.targetLang,
    files: [
      {
        fileName: file.name,
        format: 'sdlxliff',
        sourceLang: parsed.sourceLang,
        targetLang: parsed.targetLang,
        originalBlobId: blobId,
        segments,
      },
    ],
  };
}

export async function parseTradosPackage(file: File): Promise<ParsedXliffProject> {
  const buf = await file.arrayBuffer();
  const packageBlobId = newXliffBlobId();
  await saveXliffBlob(packageBlobId, buf);

  const pkg = await parseTradosPackageBuffer(buf, file.name, packageBlobId);
  const extraBlobIds: string[] = [packageBlobId];
  const files: ParsedXliffFile[] = [];

  for (const pf of pkg.files) {
    const fileBlobId = newXliffBlobId();
    await saveXliffBlob(fileBlobId, pf.originalBytes);
    extraBlobIds.push(fileBlobId);

    const segments: ParsedXliffSegment[] = pf.segments.map((s) => ({
      source: s.sourceText,
      target: s.targetText,
      xliffSegmentId: s.segmentId,
      transUnitId: s.transUnitId,
      status: sdlStatusToSegment(s.status, Boolean(s.targetText.trim())),
      matchType: sdlMatchType(s.matchPercent, s.textMatch, s.origin),
      matchScore: s.matchPercent || undefined,
      isLocked: s.locked,
      comments: s.comments.length ? s.comments : undefined,
      sdlConf: s.status,
      sdlOrigin: s.origin,
    }));

    files.push({
      fileName: pf.name,
      format: 'sdlxliff',
      sourceLang: pf.sourceLang,
      targetLang: pf.targetLang,
      originalBlobId: fileBlobId,
      packagePath: pf.path,
      segments,
    });
  }

  return {
    sourceLang: pkg.meta.sourceLang,
    targetLang: pkg.meta.targetLang,
    files,
    tradosPackage: pkg.meta,
    extraBlobIds,
  };
}

export async function parseMemoqPackage(file: File): Promise<ParsedXliffProject> {
  const buf = await file.arrayBuffer();
  const packageBlobId = newXliffBlobId();
  await saveXliffBlob(packageBlobId, buf);

  const pkg = await parseMemoqPackageBuffer(buf, file.name, packageBlobId);
  const extraBlobIds: string[] = [packageBlobId];
  const files: ParsedXliffFile[] = [];

  for (const pf of pkg.files) {
    const fileBlobId = newXliffBlobId();
    await saveXliffBlob(fileBlobId, pf.originalBytes);
    extraBlobIds.push(fileBlobId);

    const segments: ParsedXliffSegment[] = pf.segments.map((s, i) => ({
      source: s.source,
      target: s.target,
      xliffSegmentId: s.id,
      mqIndex: i,
      status: mqStatusToSegment(s.status),
      matchType:
        s.matchPercent && s.matchPercent >= 100
          ? MatchType.Exact
          : s.matchPercent && s.matchPercent >= 70
            ? MatchType.Fuzzy
            : MatchType.None,
      matchScore: s.matchPercent ?? undefined,
    }));

    files.push({
      fileName: pf.name,
      format: 'mqxliff',
      sourceLang: pf.sourceLang,
      targetLang: pf.targetLang,
      originalBlobId: fileBlobId,
      packagePath: pf.path,
      segments,
    });
  }

  return {
    sourceLang: pkg.meta.sourceLang,
    targetLang: pkg.meta.targetLang,
    files,
    memoqPackage: pkg.meta,
    extraBlobIds,
  };
}

export function buildSegmentsFromParsed(
  parsedSegments: ParsedXliffSegment[],
  fileIdx: number,
  sourceLang: string
): Segment[] {
  return parsedSegments.map((item, index) => {
    const text = item.source.trim();
    let targetText = item.target?.trim() ?? '';
    let status = item.status;
    let isLocked = item.isLocked ?? false;

    if (!isLocked) {
      isLocked = shouldAutoLockSegmentAtImport(text, sourceLang);
    }
    if (isLocked && !targetText) {
      targetText = text;
      status = SegmentStatus.Confirmed;
    }

    return {
      id: `s-${Date.now()}-${fileIdx}-${index}`,
      sourceText: text,
      targetText,
      status,
      matchType: item.matchType,
      matchScore: item.matchScore,
      isLocked,
      comments: item.comments,
      xliffSegmentId: item.xliffSegmentId,
      sdlConf: item.sdlConf,
      sdlOrigin: item.sdlOrigin,
    };
  });
}

export function buildProjectFileFromParsed(
  parsedFile: ParsedXliffFile,
  fileIdx: number,
  sourceLang: string
): ProjectFile {
  const segs = buildSegmentsFromParsed(parsedFile.segments, fileIdx, sourceLang);
  const confirmed = segs.filter(
    (s) => s.status === SegmentStatus.Confirmed || (s.isLocked && s.targetText)
  ).length;
  return {
    id: `f-${Date.now()}-${fileIdx}`,
    name: parsedFile.fileName,
    segments: segs,
    totalSegments: segs.length,
    progress: segs.length > 0 ? Math.round((confirmed / segs.length) * 100) : 0,
    interchangeFormat: parsedFile.format,
    interchangeMeta: {
      format: parsedFile.format,
      xliffSegmentId: '',
      originalBlobId: parsedFile.originalBlobId,
      sourceLang: parsedFile.sourceLang,
      targetLang: parsedFile.targetLang,
      packagePath: parsedFile.packagePath,
    },
  };
}

export function detectXliffKind(
  fileName: string
): 'sdlxliff' | 'mqxliff' | 'trados-package' | 'memoq-package' | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.sdlppx') || lower.endsWith('.sdlrpx')) return 'trados-package';
  if (lower.endsWith('.mqxlz')) return 'memoq-package';
  if (lower.endsWith('.sdlxliff')) return 'sdlxliff';
  if (lower.endsWith('.mqxliff')) return 'mqxliff';
  if (lower.endsWith('.xlf') || lower.endsWith('.xliff')) return 'sdlxliff';
  return null;
}
