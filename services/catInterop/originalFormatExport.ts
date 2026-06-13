import type { OkapiSettings, ProjectFile, Segment } from '../../types';
import { loadSourceBlob, canFormatPreservingExport } from './sourceBlobStore';
import { okapiMergeFile } from '../okapiClient';
import { isCloudDeployment } from '../deploymentMode';
import { downloadBytes } from '../xliff/xliffExport';
import {
  getOriginalFormatKind,
  supportsOriginalFormatExport,
  segmentTextForOriginalExport,
  type MonolingualExportFont,
  clampPptxFontScale,
} from './originalFormatExportTypes';

export {
  supportsOriginalFormatExport,
  getOriginalFormatKind,
  segmentTextForOriginalExport,
} from './originalFormatExportTypes';

function segmentsToMergePayload(segments: Segment[]) {
  return segments.map((seg, index) => ({
    okapiTuId: seg.okapiTuId ?? `p-${index}`,
    id: seg.id,
    source: seg.sourceText,
    target: segmentTextForOriginalExport(seg),
  }));
}

export async function exportOriginalFormatFile(
  file: ProjectFile,
  segments: Segment[],
  okapiSettings?: OkapiSettings,
  exportFont?: MonolingualExportFont,
  pptxFontScale?: number
): Promise<string> {
  if (!supportsOriginalFormatExport(file.name)) {
    throw new Error(`不支持导出原文格式：${file.name}`);
  }

  if (!canFormatPreservingExport(file)) {
    throw new Error(
      '该文件缺少原始格式备份，无法保真导出。请重新导入此文档后再导出（导入时会自动保存原文件）。'
    );
  }

  const isPptx = getOriginalFormatKind(file.name) === 'pptx';
  const mergeOptions = {
    exportFont,
    pptxFontScale: isPptx && pptxFontScale != null ? clampPptxFontScale(pptxFontScale) : undefined,
    sourceBlobId: file.sourceBlobId,
  };

  let originalBytes: ArrayBuffer;
  if (isCloudDeployment()) {
    originalBytes = new ArrayBuffer(0);
  } else {
    const blob = await loadSourceBlob(file.sourceBlobId!);
    if (!blob) {
      throw new Error('无法读取原始文件，请确认本地 DB 服务已启动并重试。');
    }
    originalBytes = blob;
  }

  const merged = await okapiMergeFile(
    file.name,
    originalBytes,
    segmentsToMergePayload(segments),
    okapiSettings,
    mergeOptions
  );
  downloadBytes(merged.bytes, merged.fileName, merged.mime);
  return merged.fileName;
}

function exportZipTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function exportOriginalFormatProjectZip(
  files: ProjectFile[],
  segmentsByFileId: Map<string, Segment[]>,
  okapiSettings?: OkapiSettings,
  exportFont?: MonolingualExportFont,
  pptxFontScale?: number
): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  let count = 0;

  for (const file of files) {
    if (!supportsOriginalFormatExport(file.name)) continue;
    const segments = segmentsByFileId.get(file.id);
    if (!segments?.length) continue;
    if (!canFormatPreservingExport(file)) continue;

    const isPptx = getOriginalFormatKind(file.name) === 'pptx';
    const mergeOptions = {
      exportFont,
      pptxFontScale: isPptx && pptxFontScale != null ? clampPptxFontScale(pptxFontScale) : undefined,
      sourceBlobId: file.sourceBlobId,
    };

    let originalBytes: ArrayBuffer;
    if (isCloudDeployment()) {
      originalBytes = new ArrayBuffer(0);
    } else {
      const blob = await loadSourceBlob(file.sourceBlobId!);
      if (!blob) continue;
      originalBytes = blob;
    }

    const merged = await okapiMergeFile(
      file.name,
      originalBytes,
      segmentsToMergePayload(segments),
      okapiSettings,
      mergeOptions
    );
    zip.file(merged.fileName, merged.bytes);
    count += 1;
  }

  if (count === 0) {
    throw new Error('没有可保真导出的文件。请确认文件已重新导入且 Okapi 服务可用。');
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipName = `项目原文格式导出_${exportZipTimestamp()}.zip`;
  downloadBytes(zipBytes, zipName, 'application/zip');
  return zipName;
}
