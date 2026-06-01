import JSZip from 'jszip';
import { parseSdlxliffXml } from './sdlxliffParser';
import { exportSdlxliffBytes } from './sdlxliffExporter';
import type { SdlExportSegment } from './sdlxliffExporter';
import { bytesToUtf8 } from './xliffBlobStore';
import type { TradosPackageMeta } from '../../types';

export interface ParsedPackageFile {
  path: string;
  name: string;
  segments: ReturnType<typeof parseSdlxliffXml>['segments'];
  sourceLang: string;
  targetLang: string;
  originalBytes: ArrayBuffer;
}

export interface ParsedTradosPackage {
  meta: TradosPackageMeta;
  packageBytes: ArrayBuffer;
  files: ParsedPackageFile[];
}

function normalizeLangCode(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, '-');
}

function parseSdlproj(xml: string): { name: string; sourceLang: string; targetLang: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let name = 'Project';
  let sourceLang = 'en';
  let targetLang = 'zh-CN';

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const ln = el.localName ?? el.tagName.replace(/^.*:/, '');

    if (ln === 'ProjectName' && el.textContent?.trim()) {
      name = el.textContent.trim();
    }

    if (ln === 'LanguageDirection') {
      const src =
        el.getAttribute('SourceLanguageCode') ??
        el.getAttribute('sourceLanguageCode');
      const tgt =
        el.getAttribute('TargetLanguageCode') ??
        el.getAttribute('targetLanguageCode');
      if (src?.trim()) sourceLang = src.trim();
      if (tgt?.trim()) targetLang = tgt.trim();
    }

    if (ln === 'SourceLanguage' && el.textContent?.trim()) sourceLang = el.textContent.trim();
    if (ln === 'TargetLanguage' && el.textContent?.trim()) targetLang = el.textContent.trim();
    if (ln === 'SourceLanguageCode' && el.textContent?.trim()) sourceLang = el.textContent.trim();
    if (ln === 'TargetLanguageCode' && el.textContent?.trim()) targetLang = el.textContent.trim();
  }

  return { name, sourceLang, targetLang };
}

/** Collect SDLXLIFF paths from the target-language folder only (matches Trados / Supervertaler). */
function collectTargetXliffPaths(
  zip: JSZip,
  targetLang: string,
  sourceLang: string
): string[] {
  const targetNorm = normalizeLangCode(targetLang);
  const sourceNorm = normalizeLangCode(sourceLang);
  const folders = new Set<string>();

  zip.forEach((relativePath) => {
    if (!relativePath.toLowerCase().endsWith('.sdlxliff')) return;
    const norm = relativePath.replace(/\\/g, '/');
    const slash = norm.indexOf('/');
    if (slash > 0) folders.add(norm.slice(0, slash));
  });

  let targetFolder: string | null = null;

  for (const folder of folders) {
    const folderNorm = normalizeLangCode(folder);
    if (folderNorm === sourceNorm) continue;
    if (folderNorm === targetNorm) {
      targetFolder = folder;
      break;
    }
  }

  if (!targetFolder) {
    const targetPrimary = targetNorm.split('-')[0];
    for (const folder of folders) {
      const folderNorm = normalizeLangCode(folder);
      if (folderNorm === sourceNorm) continue;
      if (folderNorm === targetPrimary || folderNorm.startsWith(`${targetPrimary}-`)) {
        targetFolder = folder;
        break;
      }
    }
  }

  const paths: string[] = [];
  zip.forEach((relativePath) => {
    if (!relativePath.toLowerCase().endsWith('.sdlxliff')) return;
    const norm = relativePath.replace(/\\/g, '/');
    if (targetFolder) {
      if (norm.startsWith(`${targetFolder}/`)) paths.push(relativePath);
      return;
    }
    const slash = norm.indexOf('/');
    if (slash <= 0) {
      paths.push(relativePath);
      return;
    }
    const folderNorm = normalizeLangCode(norm.slice(0, slash));
    if (folderNorm !== sourceNorm) paths.push(relativePath);
  });

  return paths;
}

export async function parseTradosPackageBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  packageBlobId: string
): Promise<ParsedTradosPackage> {
  const ext = fileName.toLowerCase().endsWith('.sdlrpx') ? 'sdlrpx' : 'sdlppx';
  const zip = await JSZip.loadAsync(buffer);

  let sdlprojPath: string | null = null;
  zip.forEach((relativePath) => {
    if (relativePath.toLowerCase().endsWith('.sdlproj') && !sdlprojPath) {
      sdlprojPath = relativePath;
    }
  });
  if (!sdlprojPath) throw new Error('包内未找到 .sdlproj 文件');

  const projXml = await zip.file(sdlprojPath)!.async('string');
  const projInfo = parseSdlproj(projXml);

  const xliffPaths = collectTargetXliffPaths(zip, projInfo.targetLang, projInfo.sourceLang);
  if (xliffPaths.length === 0) {
    throw new Error(
      `包内未找到目标语言「${projInfo.targetLang}」下的 .sdlxliff 文件，请确认 SDLPPX 是否完整。`
    );
  }

  const files: ParsedPackageFile[] = [];
  for (const xliffPath of xliffPaths) {
    const file = zip.file(xliffPath);
    if (!file) continue;
    const bytes = await file.async('arraybuffer');
    const text = bytesToUtf8(bytes);
    const parsed = parseSdlxliffXml(text);
    files.push({
      path: xliffPath,
      name: xliffPath.split(/[/\\]/).pop() ?? xliffPath,
      segments: parsed.segments,
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
      originalBytes: bytes,
    });
  }

  if (files.length === 0) {
    throw new Error('未能解析包内任何 SDLXLIFF 文件');
  }

  const meta: TradosPackageMeta = {
    packageBlobId,
    packageType: ext,
    projectName: projInfo.name,
    sourceLang: projInfo.sourceLang,
    targetLang: projInfo.targetLang,
    xliffPaths: xliffPaths.slice(),
  };

  return { meta, packageBytes: buffer, files };
}

export async function buildSdlrpxPackage(
  originalPackageBytes: ArrayBuffer,
  meta: TradosPackageMeta,
  xliffUpdates: Map<string, { originalBytes: ArrayBuffer; segments: SdlExportSegment[] }>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(originalPackageBytes);

  for (const xliffPath of meta.xliffPaths) {
    const update = xliffUpdates.get(xliffPath);
    if (!update) continue;
    const outBytes = exportSdlxliffBytes(update.originalBytes, update.segments);
    zip.file(xliffPath, outBytes);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
