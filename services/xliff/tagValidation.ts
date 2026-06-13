const TAG_ID = '[A-Za-z0-9_-]+';
const OPEN_RE = new RegExp(`<(${TAG_ID})>`, 'g');
const CLOSE_RE = new RegExp(`</(${TAG_ID})>`, 'g');
const STANDALONE_RE = new RegExp(`<(${TAG_ID})/>`, 'g');

function countTags(text: string): { open: Map<string, number>; close: Map<string, number>; standalone: number } {
  const open = new Map<string, number>();
  const close = new Map<string, number>();
  let standalone = 0;

  let m: RegExpExecArray | null;
  const o = new RegExp(OPEN_RE.source, 'g');
  while ((m = o.exec(text)) !== null) {
    open.set(m[1], (open.get(m[1]) ?? 0) + 1);
  }
  const c = new RegExp(CLOSE_RE.source, 'g');
  while ((m = c.exec(text)) !== null) {
    close.set(m[1], (close.get(m[1]) ?? 0) + 1);
  }
  const s = new RegExp(STANDALONE_RE.source, 'g');
  while (s.exec(text) !== null) standalone += 1;

  return { open, close, standalone };
}

export interface TagValidationResult {
  ok: boolean;
  message?: string;
}

export const TAG_FORMAT_QA_MESSAGE = '请注意：译文格式与原文格式不一致';

export function validateSdlMarkers(source: string, target: string): TagValidationResult {
  const src = countTags(source);
  const tgt = countTags(target);

  const ids = new Set([...src.open.keys(), ...tgt.open.keys(), ...src.close.keys(), ...tgt.close.keys()]);
  for (const id of ids) {
    const so = src.open.get(id) ?? 0;
    const sc = src.close.get(id) ?? 0;
    const to = tgt.open.get(id) ?? 0;
    const tc = tgt.close.get(id) ?? 0;
    if (so !== sc || to !== tc || so !== to) {
      return { ok: false, message: TAG_FORMAT_QA_MESSAGE };
    }
  }

  if (src.standalone !== tgt.standalone) {
    return { ok: false, message: TAG_FORMAT_QA_MESSAGE };
  }

  return { ok: true };
}
