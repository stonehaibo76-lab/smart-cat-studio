import type { ParsedSdlSegment } from './markerTags';
import { shouldImportSdlSegment } from './markerTags';

const XLIFF_NS = 'urn:oasis:names:tc:xliff:document:1.2';
const SDL_NS = 'http://sdl.com/FileTypes/SdlXliff/1.0';

type LockTuEntry = { source: string; target: string };

function localName(el: Element): string {
  const tag = el.tagName;
  const i = tag.indexOf(':');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function findChild(parent: Element, name: string): Element | null {
  for (const c of Array.from(parent.children)) {
    if (localName(c) === name) return c;
  }
  return null;
}

function findAll(parent: Element, name: string): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if (localName(el) === name) out.push(el);
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(parent);
  return out;
}

function getXid(el: Element): string {
  return el.getAttribute('xid') ?? el.getAttributeNS(SDL_NS, 'xid') ?? '';
}

function buildLockTuMap(doc: Document, commentDefs: Map<string, string>): Map<string, LockTuEntry> {
  const map = new Map<string, LockTuEntry>();
  for (const tu of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(tu) !== 'trans-unit') continue;
    const id = tu.getAttribute('id') ?? '';
    if (!id.startsWith('lockTU_')) continue;
    const src = findChild(tu, 'source');
    const tgt = findChild(tu, 'target');
    const comments: string[] = [];
    map.set(id, {
      source: src ? extractText(src, commentDefs, comments, undefined, false) : '',
      target: tgt ? extractText(tgt, commentDefs, comments, undefined, true) : '',
    });
  }
  return map;
}

function extractText(
  elem: Element,
  commentDefs: Map<string, string>,
  commentsOut: string[],
  lockTuMap: Map<string, LockTuEntry> | undefined,
  preferTarget: boolean
): string {
  const parts: string[] = [];

  const appendInline = (child: Element) => {
    const tag = localName(child);
    if (tag === 'g') {
      const id = child.getAttribute('id') ?? '';
      parts.push(`<${id}>`);
      parts.push(extractText(child, commentDefs, commentsOut, lockTuMap, preferTarget));
      parts.push(`</${id}>`);
    } else if (tag === 'x' || tag === 'ph' || tag === 'bx' || tag === 'ex') {
      const xid = getXid(child);
      if (xid && lockTuMap?.has(xid)) {
        const entry = lockTuMap.get(xid)!;
        const locked = preferTarget ? entry.target || entry.source : entry.source;
        if (locked) {
          parts.push(locked);
        } else {
          const id = child.getAttribute('id') ?? '';
          parts.push(`<${id}/>`);
        }
      } else {
        const id = child.getAttribute('id') ?? '';
        parts.push(`<${id}/>`);
      }
    } else if (tag === 'mrk') {
      const mtype = child.getAttribute('mtype') ?? '';
      if (mtype === 'x-sdl-comment') {
        const cid =
          child.getAttributeNS(SDL_NS, 'cid') ??
          child.getAttribute('cid') ??
          '';
        if (cid && commentDefs.has(cid)) {
          commentsOut.push(commentDefs.get(cid)!);
        }
      } else if (mtype !== 'seg') {
        parts.push(extractText(child, commentDefs, commentsOut, lockTuMap, preferTarget));
      }
    } else {
      parts.push(extractText(child, commentDefs, commentsOut, lockTuMap, preferTarget));
    }
  };

  if (elem.textContent && elem.children.length === 0) {
    return elem.textContent;
  }

  for (const node of Array.from(elem.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      appendInline(child);
      if (child.nextSibling?.nodeType === Node.TEXT_NODE) {
        parts.push(child.nextSibling.textContent ?? '');
      }
    }
  }
  return parts.join('');
}

function getConfStatus(segDef: Element | null): string {
  if (!segDef) return 'not_translated';
  const conf = segDef.getAttribute('conf');
  const map: Record<string, string> = {
    草稿: 'draft',
    已翻译: 'translated',
    ApprovedTranslation: 'approved',
    ApprovedSignOff: 'approved',
    RejectedTranslation: 'rejected',
    RejectedSignOff: 'rejected',
  };
  return conf ? map[conf] ?? 'not_translated' : 'not_translated';
}

function parseSegDef(tu: Element, mid: string): Element | null {
  for (const defs of Array.from(tu.getElementsByTagName('*'))) {
    if (localName(defs) !== 'seg-defs') continue;
    for (const seg of Array.from(defs.children)) {
      if (localName(seg) === 'seg' && seg.getAttribute('id') === mid) return seg;
    }
  }
  return null;
}

function isLocked(tu: Element, segDef: Element | null): boolean {
  if (segDef?.getAttribute('locked')?.toLowerCase() === 'true') return true;
  if (tu.getAttribute('translate')?.toLowerCase() === 'no') return true;
  return false;
}

function parseTransUnit(
  tu: Element,
  commentDefs: Map<string, string>,
  lockTuMap: Map<string, LockTuEntry>
): ParsedSdlSegment[] {
  const segments: ParsedSdlSegment[] = [];
  const tuId = tu.getAttribute('id') ?? '';
  const source = findChild(tu, 'source');
  const target = findChild(tu, 'target');
  const segSource = findChild(tu, 'seg-source');

  if (!source) return segments;

  if (segSource) {
    const sourceMrks = findAll(segSource, 'mrk').filter((m) => m.getAttribute('mtype') === 'seg');
    const targetMrks = target
      ? findAll(target, 'mrk').filter((m) => m.getAttribute('mtype') === 'seg')
      : [];
    const targetMap = new Map(targetMrks.map((m) => [m.getAttribute('mid') ?? '', m]));

    for (const sm of sourceMrks) {
      const mid = sm.getAttribute('mid');
      if (!mid) continue;
      const comments: string[] = [];
      let sourceText = extractText(sm, commentDefs, comments, lockTuMap, false);
      const tm = targetMap.get(mid);
      const targetComments: string[] = [];
      let targetText = tm ? extractText(tm, commentDefs, targetComments, lockTuMap, true) : '';
      const segDef = parseSegDef(tu, mid);
      segments.push({
        segmentId: `${tuId}_${mid}`,
        transUnitId: tuId,
        sourceText,
        targetText,
        status: getConfStatus(segDef),
        matchPercent: parseInt(segDef?.getAttribute('percent') ?? '0', 10) || 0,
        origin: (segDef?.getAttribute('origin') ?? '').toLowerCase(),
        textMatch: segDef?.getAttribute('text-match') ?? '',
        locked: isLocked(tu, segDef),
        comments: [...comments, ...targetComments],
      });
    }

    const fullSource = extractText(source, commentDefs, [], lockTuMap, false).trim();
    if (segments.length > 0 && fullSource && segments.every((s) => !s.sourceText.trim())) {
      if (segments.length === 1) {
        segments[0].sourceText = fullSource;
        if (!segments[0].targetText.trim() && target) {
          segments[0].targetText = extractText(target, commentDefs, [], lockTuMap, true);
        }
      }
    }
  } else {
    const comments: string[] = [];
    const sourceText = extractText(source, commentDefs, comments, lockTuMap, false);
    let targetText = '';
    const targetComments: string[] = [];
    if (target) {
      targetText = extractText(target, commentDefs, targetComments, lockTuMap, true);
    }
    let sdlSeg: Element | null = null;
    for (const el of Array.from(tu.getElementsByTagName('*'))) {
      if (localName(el) === 'seg') {
        sdlSeg = el;
        break;
      }
    }
    segments.push({
      segmentId: tuId,
      transUnitId: tuId,
      sourceText,
      targetText,
      status: getConfStatus(sdlSeg),
      matchPercent: parseInt(sdlSeg?.getAttribute('percent') ?? '0', 10) || 0,
      origin: (sdlSeg?.getAttribute('origin') ?? '').toLowerCase(),
      textMatch: sdlSeg?.getAttribute('text-match') ?? '',
      locked: isLocked(tu, sdlSeg),
      comments: [...comments, ...targetComments],
    });
  }
  return segments;
}

function loadCommentDefs(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(el) !== 'cmt-def') continue;
    const id = el.getAttribute('id');
    if (!id) continue;
    const comment = el.querySelector('Comment');
    if (comment?.textContent) map.set(id, comment.textContent);
  }
  return map;
}

export interface SdlxliffParseResult {
  segments: ParsedSdlSegment[];
  sourceLang: string;
  targetLang: string;
}

export function parseSdlxliffXml(xmlText: string): SdlxliffParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('SDLXLIFF XML 解析失败');
  }

  const commentDefs = loadCommentDefs(doc);
  const lockTuMap = buildLockTuMap(doc, commentDefs);

  let fileEl: Element | null = null;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(el) === 'file') {
      fileEl = el;
      break;
    }
  }

  const sourceLang = fileEl?.getAttribute('source-language') ?? 'en';
  const targetLang = fileEl?.getAttribute('target-language') ?? 'zh-CN';

  const segments: ParsedSdlSegment[] = [];
  for (const tu of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(tu) !== 'trans-unit') continue;
    const id = tu.getAttribute('id') ?? '';
    if (id.startsWith('lockTU_')) continue;
    segments.push(...parseTransUnit(tu, commentDefs, lockTuMap));
  }

  const filtered = segments.filter(shouldImportSdlSegment);

  return { segments: filtered, sourceLang, targetLang };
}

export { XLIFF_NS, SDL_NS };
