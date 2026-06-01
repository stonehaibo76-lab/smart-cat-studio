/**
 * Import-time auto-lock: marks segments that typically need no translation work.
 *
 * Any source language: lock when the trimmed segment is only numeric characters (e.g. 18, １２３).
 *
 * EN source: only lock lines that are purely numbers/symbols (no letters). Typography like
 * smart quotes, ©, bullets is allowed in prose and must not trigger a lock.
 *
 * zh-CN source: lock segments with no Chinese characters (numbers/symbols-only rows in CN docs).
 */
export function shouldAutoLockSegmentAtImport(sourceText: string, sourceLang: string): boolean {
  const text = sourceText.trim();
  if (!text) return false;

  // 任意语种：原文整段仅为数字（Unicode 数字类 Nd），无需翻译
  if (/^\p{Nd}+$/u.test(text)) return true;

  if (sourceLang === 'zh-CN') {
    return !/[\u4e00-\u9fa5]/.test(text);
  }

  if (sourceLang.startsWith('en')) {
    return /^[\d\s\p{P}<>=+$/]+$/u.test(text);
  }

  return false;
}
