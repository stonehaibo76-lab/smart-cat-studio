import { calculateMatchScoreValue, normalizeForMatching, sourcesEqual } from './tmMatchScore.mjs';

const TM_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tm_units (
    tm_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    source_norm TEXT NOT NULL,
    source_raw TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY (tm_id, unit_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tm_units_tm_source ON tm_units(tm_id, source_norm);
`;

export function attachTmIndex(sqlite) {
  sqlite.exec(TM_SCHEMA);

  function syncTranslationMemories(tms) {
    if (!Array.isArray(tms)) return { count: 0 };
    const delAll = sqlite.prepare('DELETE FROM tm_units');
    const ins = sqlite.prepare(
      `INSERT OR REPLACE INTO tm_units (tm_id, unit_id, source_norm, source_raw, target)
       VALUES (?, ?, ?, ?, ?)`
    );
    let count = 0;
    const tx = sqlite.transaction((list) => {
      delAll.run();
      for (const tm of list) {
        if (!tm?.id || !Array.isArray(tm.units)) continue;
        for (const u of tm.units) {
          if (!u?.source?.trim() || !u?.target?.trim()) continue;
          ins.run(
            tm.id,
            u.id || `${tm.id}-${count}`,
            normalizeForMatching(u.source),
            u.source,
            u.target
          );
          count += 1;
        }
      }
    });
    tx(tms);
    return { count };
  }

  function backfillFromCollection(loadCollectionFn) {
    return loadCollectionFn('translationMemories').then((tms) => syncTranslationMemories(tms));
  }

  function searchTmMatches({ tmIds, sourceText, minScore = 50, limit = 20, tmNames = {} }) {
    if (!sourceText?.trim() || !tmIds?.length) return [];

    const norm = normalizeForMatching(sourceText);
    const ids = tmIds.filter(Boolean);
    const placeholders = ids.map(() => '?').join(',');

    const exactRows = sqlite
      .prepare(
        `SELECT tm_id, unit_id, source_raw, target FROM tm_units
         WHERE tm_id IN (${placeholders}) AND source_norm = ?`
      )
      .all(...ids, norm);

    const hits = [];
    const seen = new Set();

    for (const row of exactRows) {
      const key = `${row.tm_id}:${row.unit_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        id: row.unit_id,
        source: row.source_raw,
        target: row.target,
        score: 100,
        tmId: row.tm_id,
        sourceTM: tmNames[row.tm_id] || row.tm_id,
      });
    }

    if (hits.length >= limit) {
      return hits.slice(0, limit);
    }

    const allRows = sqlite
      .prepare(
        `SELECT tm_id, unit_id, source_raw, target FROM tm_units WHERE tm_id IN (${placeholders})`
      )
      .all(...ids);

    for (const row of allRows) {
      const key = `${row.tm_id}:${row.unit_id}`;
      if (seen.has(key)) continue;
      const score = calculateMatchScoreValue(sourceText, row.source_raw);
      if (score < minScore) continue;
      seen.add(key);
      hits.push({
        id: row.unit_id,
        source: row.source_raw,
        target: row.target,
        score,
        tmId: row.tm_id,
        sourceTM: tmNames[row.tm_id] || row.tm_id,
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  function findExactMatch(sourceText, tmIds) {
    if (!sourceText?.trim() || !tmIds?.length) return null;
    const norm = normalizeForMatching(sourceText);
    const placeholders = tmIds.map(() => '?').join(',');
    const row = sqlite
      .prepare(
        `SELECT tm_id, unit_id, source_raw, target FROM tm_units
         WHERE tm_id IN (${placeholders}) AND source_norm = ? LIMIT 1`
      )
      .get(...tmIds, norm);
    if (!row) return null;
    return {
      id: row.unit_id,
      source: row.source_raw,
      target: row.target,
      tmId: row.tm_id,
    };
  }

  return {
    syncTranslationMemories,
    backfillFromCollection,
    searchTmMatches,
    findExactMatch,
    sourcesEqual,
  };
}
