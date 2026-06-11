/** Server-side TM fuzzy score (mirrors services/tmMatchService.ts). */

export function normalizeForMatching(text) {
  if (!text) return '';
  let t = String(text).normalize('NFC');
  t = t.replace(/\u00a0/g, ' ');
  t = t.replace(/\u2007/g, ' ');
  t = t.replace(/\u202f/g, ' ');
  t = t.replace(/\s+/g, ' ');
  return t.trim();
}

export function sourcesEqual(a, b) {
  return normalizeForMatching(a) === normalizeForMatching(b);
}

export function calculateMatchScoreValue(source, target) {
  if (!source || !target) return 0;
  if (sourcesEqual(source, target)) return 100;

  const a = normalizeForMatching(source).toLowerCase();
  const b = normalizeForMatching(target).toLowerCase();
  if (a === b) return 100;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLength = Math.max(a.length, b.length);
  return Math.max(0, Math.floor(((maxLength - distance) / maxLength) * 100));
}
