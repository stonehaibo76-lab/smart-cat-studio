import * as XLSX from 'xlsx';

export type SimpleXlsxSegment = { source: string; target: string };

function isLikelyHeaderRow(source: string, target: string): boolean {
  const lowerS = source.toLowerCase();
  const lowerT = target.toLowerCase();
  return (
    (lowerS === 'source' ||
      lowerS === '原文' ||
      lowerS === 'src' ||
      lowerS.includes('源文')) &&
    (lowerT === 'target' ||
      lowerT === '译文' ||
      lowerT === 'tgt' ||
      lowerT.includes('译文') ||
      !target)
  );
}

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/** Client-side XLSX parse when Java Okapi extract is unavailable or returns no segments. */
export function parseSimpleXlsx(arrayBuffer: ArrayBuffer): SimpleXlsxSegment[] | null {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  } catch {
    return null;
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return null;

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  if (!rows.length) return null;

  const bilingual: SimpleXlsxSegment[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const source = cellText(row[0]);
    const target = cellText(row[1]);
    if (!source) continue;
    if (i === 0 && isLikelyHeaderRow(source, target)) continue;
    bilingual.push({ source, target });
  }
  if (bilingual.length > 0) return bilingual;

  const mono: SimpleXlsxSegment[] = [];
  for (const row of rows) {
    for (const cell of row as unknown[]) {
      const text = cellText(cell);
      if (!text) continue;
      mono.push({ source: text, target: '' });
    }
  }
  return mono.length > 0 ? mono : null;
}
