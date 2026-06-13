import { markersToXml } from './markerTags';
import { detectBom, utf8ToBytes, bytesToUtf8 } from './xliffBlobStore';

export interface SdlExportSegment {
  segmentId: string;
  targetText: string;
  status?: string;
  modified?: boolean;
}

const TAG_ID = '[A-Za-z0-9_]+';

function findMaxLockedId(content: string): number {
  const ids = [...content.matchAll(/\bid="locked(\d+)"/g)].map((m) => parseInt(m[1], 10));
  return ids.length ? Math.max(...ids) : 0;
}

type XidMapping = [string, string, string, string];

function getSegSourceLockXids(tuBlock: string, mid: string): Record<string, string> {
  const segSourceM = tuBlock.match(/<seg-source[^>]*>([\s\S]*?)<\/seg-source>/);
  if (!segSourceM) return {};
  const segSource = segSourceM[1];
  const mrkRe = new RegExp(
    `<mrk\\s+(?=[^>]*\\bmtype="seg")(?=[^>]*\\bmid="${mid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")[^>]*>([\\s\\S]*?)</mrk>`
  );
  const mrkM = segSource.match(mrkRe);
  if (!mrkM) return {};
  const mrkContent = mrkM[1];
  const result: Record<string, string> = {};
  for (const m of mrkContent.matchAll(/<x\s+[^>]*?\bid="(locked\d+)"[^>]*?\bxid="(lockTU_[^"]+)"[^>]*\/>/g)) {
    result[m[1]] = m[2];
  }
  for (const m of mrkContent.matchAll(/<x\s+[^>]*?\bxid="(lockTU_[^"]+)"[^>]*?\bid="(locked\d+)"[^>]*\/>/g)) {
    result[m[2]] = m[1];
  }
  return result;
}

function restoreAndRemapLockXids(
  newContent: string,
  segSourceXids: Record<string, string>,
  lockedIdCounter: number,
  allXidMappings: XidMapping[]
): { content: string; counter: number } {
  let counter = lockedIdCounter;
  let out = newContent;
  for (const [oldElemId, oldXid] of Object.entries(segSourceXids)) {
    const pattern = new RegExp(`<x\\s+id="${oldElemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"(\\s*)/>`);
    const m = out.match(pattern);
    if (!m) continue;
    counter += 1;
    const newElemId = `locked${counter}`;
    const newXid = `lockTU_${crypto.randomUUID()}`;
    allXidMappings.push([oldXid, newXid, oldElemId, newElemId]);
    const newElem = `<x id="${newElemId}" xid="${newXid}"/>`;
    out = out.replace(pattern, newElem);
  }
  return { content: out, counter };
}

function insertLockTus(content: string, xidMappings: XidMapping[]): string {
  if (!xidMappings.length) return content;
  let result = content;
  for (const [oldXid, newXid] of xidMappings) {
    const esc = oldXid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lockTuRe = new RegExp(`<trans-unit\\s+(?=[^>]*\\bid="${esc}")[^>]*>[\\s\\S]*?</trans-unit>`);
    const m = result.match(lockTuRe);
    if (!m) continue;
    const originalTu = m[0];
    const newTu = originalTu.replace(`id="${oldXid}"`, `id="${newXid}"`, 1);
    result = result.replace(originalTu, newTu + originalTu);
  }
  return result;
}

function replaceTargetContent(
  content: string,
  segmentMap: Map<string, SdlExportSegment>
): string {
  let lockedIdCounter = findMaxLockedId(content);
  const allXidMappings: XidMapping[] = [];

  const replaceTu = (tuBlock: string): string => {
    const tuIdM = tuBlock.match(/<trans-unit\s+[^>]*?id="([^"]+)"/);
    if (!tuIdM) return tuBlock;
    const tuId = tuIdM[1];
    if (tuId.startsWith('lockTU_')) return tuBlock;

    const tuTranslations = new Map<string, SdlExportSegment>();
    for (const [sid, seg] of segmentMap) {
      if (seg.targetText && (sid.startsWith(`${tuId}_`) || sid === tuId)) {
        tuTranslations.set(sid, seg);
      }
    }
    if (!tuTranslations.size) return tuBlock;

    const targetM = tuBlock.match(/(<target[^>]*>)([\s\S]*?)(<\/target>)/);
    if (!targetM) return tuBlock;

    const targetOpen = targetM[1];
    let targetInner = targetM[2];
    const targetClose = targetM[3];
    let replacedCount = 0;

    const replaceMrk = (mrkOpen: string, mrkContent: string): string => {
      const midM = mrkOpen.match(/\bmid="(\d+)"/);
      if (!midM) return `${mrkOpen}${mrkContent}</mrk>`;
      const mid = midM[1];
      const segment = tuTranslations.get(`${tuId}_${mid}`);
      if (!segment?.targetText) return `${mrkOpen}${mrkContent}</mrk>`;
      let newContent = markersToXml(segment.targetText);
      if (mrkContent.includes('xid="')) {
        const existingXids: Record<string, string> = {};
        for (const lm of mrkContent.matchAll(/<x\s+[^>]*?\bid="(locked\d+)"[^>]*?\bxid="(lockTU_[^"]+)"[^>]*\/>/g)) {
          existingXids[lm[1]] = lm[2];
        }
        for (const eid of Object.keys(existingXids)) {
          const bare = new RegExp(`<x\\s+id="${eid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"(\\s*)/>`);
          newContent = newContent.replace(bare, `<x id="${eid}" xid="${existingXids[eid]}"/>`);
        }
      } else if (/<x\s+id="locked\d+"/.test(newContent)) {
        const segXids = getSegSourceLockXids(tuBlock, mid);
        if (Object.keys(segXids).length) {
          const r = restoreAndRemapLockXids(newContent, segXids, lockedIdCounter, allXidMappings);
          newContent = r.content;
          lockedIdCounter = r.counter;
        }
      }
      replacedCount += 1;
      return `${mrkOpen}${newContent}</mrk>`;
    };

    const mrkPattern = new RegExp(
      '(<mrk\\s+(?=[^>]*\\bmtype="seg")(?=[^>]*\\bmid="\\d+")[^>]*(?<!\\/)>)([\\s\\S]*?)(</mrk>)',
      'g'
    );
    targetInner = targetInner.replace(mrkPattern, (_, open, inner) => replaceMrk(open, inner));

    const selfClosePattern =
      /<mrk\s+(?=[^>]*\bmtype="seg")(?=[^>]*\bmid="\d+")[^>]*?\s*\/>/g;
    targetInner = targetInner.replace(selfClosePattern, (fullTag) => {
      const midM = fullTag.match(/\bmid="(\d+)"/);
      if (!midM) return fullTag;
      const segment = tuTranslations.get(`${tuId}_${midM[1]}`);
      if (!segment?.targetText) return fullTag;
      let newContent = markersToXml(segment.targetText);
      const segXids = getSegSourceLockXids(tuBlock, midM[1]);
      if (Object.keys(segXids).length) {
        const r = restoreAndRemapLockXids(newContent, segXids, lockedIdCounter, allXidMappings);
        newContent = r.content;
        lockedIdCounter = r.counter;
      }
      replacedCount += 1;
      const openTag = fullTag.replace(/\s*\/?>$/, '>');
      return `${openTag}${newContent}</mrk>`;
    });

    if (replacedCount === 0) {
      const unseg = tuTranslations.get(tuId);
      if (unseg?.targetText) {
        targetInner = markersToXml(unseg.targetText);
      }
    }

    const newTarget = `${targetOpen}${targetInner}${targetClose}`;
    return tuBlock.slice(0, targetM.index!) + newTarget + tuBlock.slice(targetM.index! + targetM[0].length);
  };

  let result = content.replace(/<trans-unit\s[^>]*>[\s\S]*?<\/trans-unit>/g, replaceTu);
  if (allXidMappings.length) {
    result = insertLockTus(result, allXidMappings);
  }
  return result;
}

function replaceSegAttributes(content: string, segmentMap: Map<string, SdlExportSegment>): string {
  const statusToConf: Record<string, string> = {
    draft: '草稿',
    translated: '已翻译',
    pretranslated: '已翻译',
    approved: 'ApprovedTranslation',
    proofread: 'ApprovedTranslation',
    rejected: 'RejectedTranslation',
  };

  return content.replace(/<sdl:seg\s+(?=[^>]*\bid="(\d+)")[^>]*(?:\/>|>)/g, (segText, mid) => {
    let matching: SdlExportSegment | undefined;
    for (const [sid, seg] of segmentMap) {
      if (sid.endsWith(`_${mid}`) || sid === mid) {
        matching = seg;
        break;
      }
    }
    if (!matching?.status) return segText;
    const newConf = statusToConf[matching.status];
    if (!newConf) return segText;
    let out = segText;
    if (/conf="/.test(out)) {
      out = out.replace(/conf="[^"]*"/, `conf="${newConf}"`);
    } else {
      out = out.replace('<sdl:seg ', `<sdl:seg conf="${newConf}" `);
    }
    if (matching.modified && (newConf === '已翻译' || newConf === 'ApprovedTranslation')) {
      if (/origin="/.test(out)) {
        out = out.replace(/origin="[^"]*"/, 'origin="interactive"');
      } else {
        out = out.replace('<sdl:seg ', '<sdl:seg origin="interactive" ');
      }
      out = out.replace(/\s+origin-system="[^"]*"/g, '');
      out = out.replace(/\s+percent="[^"]*"/g, '');
      out = out.replace(/\s+text-match="[^"]*"/g, '');
    }
    return out;
  });
}

export function exportSdlxliffBytes(
  originalBytes: ArrayBuffer,
  segments: SdlExportSegment[]
): Uint8Array {
  const hasBom = detectBom(originalBytes);
  let content = bytesToUtf8(originalBytes);
  const map = new Map<string, SdlExportSegment>();
  for (const s of segments) {
    if (s.segmentId) map.set(s.segmentId, s);
  }
  content = replaceTargetContent(content, map);
  content = replaceSegAttributes(content, map);
  return utf8ToBytes(content, hasBom);
}

export function exportSdlxliffFromText(
  originalText: string,
  segments: SdlExportSegment[],
  preserveBom = false
): Uint8Array {
  const bytes = new TextEncoder().encode(originalText);
  if (!preserveBom) return exportSdlxliffBytes(bytes.buffer, segments);
  const withBom = new Uint8Array(3 + bytes.length);
  withBom[0] = 0xef;
  withBom[1] = 0xbb;
  withBom[2] = 0xbf;
  withBom.set(bytes, 3);
  return exportSdlxliffBytes(withBom.buffer, segments);
}
