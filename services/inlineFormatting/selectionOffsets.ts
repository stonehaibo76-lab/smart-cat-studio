/** Visible-text selection offsets inside a contenteditable root. */
export function getPlainSelectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const end = pre.toString().length;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function readActivePlainTextSelection(): { start: number; end: number } | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) {
    return getPlainSelectionOffsets(active);
  }
  if (active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start !== end) return { start: Math.min(start, end), end: Math.max(start, end) };
  }
  return null;
}

/** Plain-text selection inside the active target editor only (ignores source fields). */
export function readTargetEditorPlainSelection(
  targetTextareaRef: HTMLTextAreaElement | null,
  mapTextareaOffsets?: (start: number, end: number) => { start: number; end: number }
): { start: number; end: number } | null {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active === targetTextareaRef) {
    const s = active.selectionStart ?? 0;
    const e = active.selectionEnd ?? 0;
    if (s === e) return null;
    const raw = { start: Math.min(s, e), end: Math.max(s, e) };
    return mapTextareaOffsets ? mapTextareaOffsets(raw.start, raw.end) : raw;
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    const sel = getPlainSelectionOffsets(active);
    if (sel && sel.start < sel.end) return sel;
  }
  return null;
}
