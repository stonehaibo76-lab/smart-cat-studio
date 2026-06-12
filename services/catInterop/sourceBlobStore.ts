import { loadXliffBlob, saveXliffBlob } from '../xliff/xliffBlobStore';

/** Reuses xliff_blobs storage for original source files (docx, pptx, html, txt). */
export function newSourceBlobId(): string {
  return `source-${crypto.randomUUID()}`;
}

export async function saveSourceBlob(
  id: string,
  data: ArrayBuffer | Uint8Array
): Promise<void> {
  await saveXliffBlob(id, data);
}

export async function loadSourceBlob(id: string): Promise<ArrayBuffer | null> {
  return loadXliffBlob(id);
}

export function canFormatPreservingExport(file: { sourceBlobId?: string; name: string }): boolean {
  if (!file.sourceBlobId) return false;
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith('.docx') ||
    lower.endsWith('.pptx') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm')
  );
}
