/** 从 MT 结果 textarea 取操作文本：优先划选片段，否则全文。 */
export function getEditableMtActionText(
  textarea: HTMLTextAreaElement | null | undefined,
  fallback = ''
): string {
  if (textarea) {
    const { selectionStart, selectionEnd, value } = textarea;
    if (
      selectionStart != null &&
      selectionEnd != null &&
      selectionStart !== selectionEnd
    ) {
      const slice = value.slice(
        Math.min(selectionStart, selectionEnd),
        Math.max(selectionStart, selectionEnd)
      );
      if (slice) return slice;
    }
    if (value.trim()) return value;
  }
  return fallback.trim();
}

export type MtInsertMode = 'replace' | 'insert-at-cursor';

/** 解析插入：划选时插入到句段光标处，否则整句替换。 */
export function resolveMtInsertPayload(
  textarea: HTMLTextAreaElement | null | undefined,
  fullText: string
): { text: string; mode: MtInsertMode } {
  if (textarea) {
    const { selectionStart, selectionEnd, value } = textarea;
    if (
      selectionStart != null &&
      selectionEnd != null &&
      selectionStart !== selectionEnd
    ) {
      const partial = value.slice(
        Math.min(selectionStart, selectionEnd),
        Math.max(selectionStart, selectionEnd)
      );
      if (partial.trim()) {
        return { text: partial, mode: 'insert-at-cursor' };
      }
    }
  }
  return {
    text: getEditableMtActionText(textarea, fullText),
    mode: 'replace',
  };
}
