import JSZip from 'jszip';
import { parseMqxliffXml, applyMqTranslations, mqxliffToBytes } from './mqxliffHandler';
import { bytesToUtf8, detectBom } from './xliffBlobStore';
import type { MemoQPackageMeta } from '../../types';

export interface ParsedMemoqPackageFile {
  path: string;
  name: string;
  segments: ReturnType<typeof parseMqxliffXml>['segments'];
  sourceLang: string;
  targetLang: string;
  originalBytes: ArrayBuffer;
}

export interface ParsedMemoqPackage {
  meta: MemoQPackageMeta;
  packageBytes: ArrayBuffer;
  files: ParsedMemoqPackageFile[];
}

function localName(el: Element): string {
  const tag = el.tagName;
  const i = tag.indexOf(':');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function extractOriginalFileName(xmlText: string): string | null {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(el) === 'file') {
      const original = el.getAttribute('original')?.trim();
      if (original) return original.split(/[/\\]/).pop() ?? original;
    }
  }
  return null;
}

function collectMqxliffPaths(zip: JSZip): string[] {
  const paths: string[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.toLowerCase().endsWith('.mqxliff')) {
      paths.push(relativePath);
    }
  });
  return paths.sort();
}

export async function parseMemoqPackageBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  packageBlobId: string
): Promise<ParsedMemoqPackage> {
  const zip = await JSZip.loadAsync(buffer);
  const mqxliffPaths = collectMqxliffPaths(zip);

  if (mqxliffPaths.length === 0) {
    throw new Error('包内未找到 .mqxliff 文件，请确认 MQXLZ 是否完整。');
  }

  const fallbackStem = fileName.replace(/\.mqxlz$/i, '') || 'document';
  const files: ParsedMemoqPackageFile[] = [];
  let sourceLang = 'en';
  let targetLang = 'zh-CN';

  for (const mqxliffPath of mqxliffPaths) {
    const entry = zip.file(mqxliffPath);
    if (!entry) continue;
    const bytes = await entry.async('arraybuffer');
    const text = bytesToUtf8(bytes);
    const parsed = parseMqxliffXml(text);
    const displayName =
      extractOriginalFileName(text) ??
      mqxliffPath.split(/[/\\]/).pop()?.replace(/\.mqxliff$/i, '') ??
      fallbackStem;

    if (files.length === 0) {
      sourceLang = parsed.sourceLang;
      targetLang = parsed.targetLang;
    }

    files.push({
      path: mqxliffPath,
      name: displayName,
      segments: parsed.segments,
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
      originalBytes: bytes,
    });
  }

  if (files.length === 0) {
    throw new Error('未能解析包内任何 MQXLIFF 文件');
  }

  const meta: MemoQPackageMeta = {
    packageBlobId,
    originalFileName: fileName,
    sourceLang,
    targetLang,
    mqxliffPaths: mqxliffPaths.slice(),
  };

  return { meta, packageBytes: buffer, files };
}

export async function buildMqxlzPackage(
  originalPackageBytes: ArrayBuffer,
  meta: MemoQPackageMeta,
  xliffUpdates: Map<string, { originalBytes: ArrayBuffer; translations: string[] }>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(originalPackageBytes);

  for (const mqxliffPath of meta.mqxliffPaths) {
    const update = xliffUpdates.get(mqxliffPath);
    if (!update) continue;
    const text = bytesToUtf8(update.originalBytes);
    const hadBom = detectBom(update.originalBytes);
    const outXml = applyMqTranslations(text, update.translations);
    zip.file(mqxliffPath, mqxliffToBytes(outXml, hadBom));
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
