import type { TranslationMemoryUnit } from '../types';

export interface TmxImportUnit {
  source: string;
  target: string;
  sourceLang?: string;
  targetLang?: string;
}

export interface TmxParseResult {
  units: TmxImportUnit[];
  sourceLang?: string;
  targetLang?: string;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripInlineTags(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, '')).trim();
}

function langFromTuv(block: string): string | undefined {
  const m = block.match(/\bxml:lang="([^"]+)"/i) || block.match(/\blang="([^"]+)"/i);
  return m?.[1]?.trim();
}

/**
 * Parse TMX 1.4 file content into TM units (first two distinct langs in each TU).
 */
export function parseTmxContent(xml: string): TmxParseResult {
  const units: TmxImportUnit[] = [];
  let fileSrcLang: string | undefined;
  let fileTgtLang: string | undefined;

  const headerMatch = xml.match(/<header[^>]*>/i);
  if (headerMatch) {
    const sr = headerMatch[0].match(/\bsrclang="([^"]+)"/i);
    if (sr) fileSrcLang = sr[1].trim();
  }

  const tuRe = /<tu[\s>][\s\S]*?<\/tu>/gi;
  let tuMatch: RegExpExecArray | null;
  while ((tuMatch = tuRe.exec(xml)) !== null) {
    const tuBlock = tuMatch[0];
    const tuvRe = /<tuv[\s>][\s\S]*?<\/tuv>/gi;
    const tuvs: { lang?: string; text: string }[] = [];
    let tuvMatch: RegExpExecArray | null;
    while ((tuvMatch = tuvRe.exec(tuBlock)) !== null) {
      const tuvBlock = tuvMatch[0];
      const segMatch = tuvBlock.match(/<seg[^>]*>([\s\S]*?)<\/seg>/i);
      if (!segMatch) continue;
      const text = stripInlineTags(segMatch[1]);
      if (!text) continue;
      tuvs.push({ lang: langFromTuv(tuvBlock), text });
    }
    if (tuvs.length < 2) continue;
    const source = tuvs[0].text;
    const target = tuvs[1].text;
    if (!source || !target) continue;
    units.push({
      source,
      target,
      sourceLang: tuvs[0].lang ?? fileSrcLang,
      targetLang: tuvs[1].lang,
    });
    if (!fileTgtLang && tuvs[1].lang) fileTgtLang = tuvs[1].lang;
  }

  return { units, sourceLang: fileSrcLang, targetLang: fileTgtLang };
}

export async function parseTmxFile(file: File): Promise<TmxParseResult> {
  const text = await file.text();
  return parseTmxContent(text);
}

export function tmxUnitsToMemoryUnits(units: TmxImportUnit[]): TranslationMemoryUnit[] {
  const now = new Date().toISOString().slice(0, 10);
  return units.map((u, i) => ({
    id: `tmx-${Date.now()}-${i}`,
    source: u.source,
    target: u.target,
    lastUsed: now,
    usageCount: 0,
  }));
}
