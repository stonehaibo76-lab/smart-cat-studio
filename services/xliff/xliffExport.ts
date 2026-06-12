import type { Project, ProjectFile, Segment } from '../../types';
import { exportSdlxliffBytes, type SdlExportSegment } from './sdlxliffExporter';
import { applyMqTranslations, mqxliffToBytes } from './mqxliffHandler';
import { buildSdlrpxPackage } from './tradosPackageHandler';
import { buildMqxlzPackage } from './memoqPackageHandler';
import { loadXliffBlob, bytesToUtf8, detectBom } from './xliffBlobStore';
import { inferFileInterchangeFormat } from './projectXliffDetect';
import { segmentStatusToSdlSlug } from '../../utils/segmentStatusUi';

function segmentToSdlExport(seg: Segment): SdlExportSegment {
  return {
    segmentId: seg.xliffSegmentId ?? '',
    targetText: seg.targetText,
    status: segmentStatusToSdlSlug(seg.status),
    modified: seg.xliffModified === true,
  };
}

export async function exportProjectFileXliff(
  file: ProjectFile,
  project: Project
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const blobId = file.interchangeMeta?.originalBlobId;
  if (!blobId) throw new Error('缺少原始 XLIFF 文件引用');

  const original = await loadXliffBlob(blobId);
  if (!original) throw new Error('无法加载原始 XLIFF 文件，请确认本地数据库服务已启动');

  const hadBom = detectBom(original);

  if (inferFileInterchangeFormat(file) === 'mqxliff') {
    const text = bytesToUtf8(original);
    const translations = file.segments.map((s) => s.targetText);
    const outXml = applyMqTranslations(text, translations);
    const base = file.name.replace(/\.[^.]+$/, '');
    return { bytes: mqxliffToBytes(outXml, hadBom), fileName: `${base}_translated.mqxliff` };
  }

  const exports: SdlExportSegment[] = file.segments
    .filter((s) => s.xliffSegmentId)
    .map(segmentToSdlExport);

  const bytes = exportSdlxliffBytes(original, exports);
  const base = file.name.replace(/\.[^.]+$/, '');
  return { bytes, fileName: `${base}_translated.sdlxliff` };
}

export async function exportSdlrpxPackage(project: Project): Promise<{ bytes: Uint8Array; fileName: string }> {
  const pkg = project.tradosPackage;
  if (!pkg) throw new Error('当前项目不是 Trados 包项目');

  const packageBytes = await loadXliffBlob(pkg.packageBlobId);
  if (!packageBytes) throw new Error('无法加载原始 SDLPPX/SDLRPX 包');

  const updates = new Map<string, { originalBytes: ArrayBuffer; segments: SdlExportSegment[] }>();

  for (const file of project.files) {
    const path = file.interchangeMeta?.packagePath;
    const blobId = file.interchangeMeta?.originalBlobId;
    if (!path || !blobId) continue;
    const original = await loadXliffBlob(blobId);
    if (!original) continue;
    updates.set(path, {
      originalBytes: original,
      segments: file.segments.filter((s) => s.xliffSegmentId).map(segmentToSdlExport),
    });
  }

  const bytes = await buildSdlrpxPackage(packageBytes, pkg, updates);
  const stem = pkg.projectName.replace(/[^\w.\-]+/g, '_') || 'package';
  return { bytes, fileName: `${stem}_translated.sdlrpx` };
}

export async function exportMqxlzPackage(project: Project): Promise<{ bytes: Uint8Array; fileName: string }> {
  const pkg = project.memoqPackage;
  if (!pkg) throw new Error('当前项目不是 memoQ 包项目');

  const packageBytes = await loadXliffBlob(pkg.packageBlobId);
  if (!packageBytes) throw new Error('无法加载原始 MQXLZ 包');

  const updates = new Map<string, { originalBytes: ArrayBuffer; translations: string[] }>();

  for (const file of project.files) {
    const path = file.interchangeMeta?.packagePath;
    const blobId = file.interchangeMeta?.originalBlobId;
    if (!path || !blobId) continue;
    const original = await loadXliffBlob(blobId);
    if (!original) continue;
    updates.set(path, {
      originalBytes: original,
      translations: file.segments.map((s) => s.targetText),
    });
  }

  const bytes = await buildMqxlzPackage(packageBytes, pkg, updates);
  const stem = pkg.originalFileName.replace(/\.mqxlz$/i, '').replace(/[^\w.\-]+/g, '_') || 'package';
  return { bytes, fileName: `${stem}_translated.mqxlz` };
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mime = 'application/xml'): void {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export type XliffFileExportFormat = 'sdlxliff' | 'mqxliff';

/** Export one or all bilingual XLIFF files in a project (downloads to browser). */
export async function exportXliffFilesFromProject(
  project: Project,
  format: XliffFileExportFormat,
  scope: 'currentFile' | 'project',
  activeFileId?: string | null
): Promise<string[]> {
  const activeFile =
    project.files.find((f) => f.id === activeFileId) ?? project.files[0] ?? null;
  const matchFormat = (f: ProjectFile) => inferFileInterchangeFormat(f) === format;

  const filesToWrite =
    scope === 'project'
      ? project.files.filter(matchFormat)
      : activeFile && matchFormat(activeFile)
        ? [activeFile]
        : [];

  if (filesToWrite.length === 0) {
    throw new Error(
      format === 'sdlxliff'
        ? '当前范围没有 SDLXLIFF 文件可导出'
        : '当前范围没有 MQXLIFF 文件可导出'
    );
  }

  const saved: string[] = [];
  for (const file of filesToWrite) {
    const { bytes, fileName } = await exportProjectFileXliff(file, project);
    downloadBytes(bytes, fileName);
    saved.push(fileName);
  }
  return saved;
}
