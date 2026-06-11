import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { attachTmIndex } from './tmIndex.mjs';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS settings_kv (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS xliff_blobs (
    id TEXT PRIMARY KEY,
    payload BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const SQLITE_MAGIC = Buffer.from('SQLite format 3\x00');
const SETTINGS_ORG_ID_ENV = process.env.SMARTCAT_SETTINGS_ORG_ID;

export function createSqliteStore(projectRoot) {
  const CONFIG_REL = 'smartcat-db-path.json';
  const envLocksPath = Boolean(process.env.SMARTCAT_DB_PATH?.trim());

  let settingsKvMeta = { hasOrgId: false, orgIdIsInteger: false };
  let documentsMeta = { hasOrgId: false, orgIdIsInteger: false };
  let cachedSettingsOrgId = undefined;
  let cachedDocumentsOrgId = undefined;
  let pathResolvedFrom = 'default';
  let dbPath = '';
  let sqlite = null;

  function configPathAbs() {
    return path.join(projectRoot, CONFIG_REL);
  }

  function normalizeDatabasePath(input) {
    const t = String(input ?? '')
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!t) throw new Error('数据库路径不能为空');
    if (path.isAbsolute(t)) return path.normalize(t);
    return path.normalize(path.join(projectRoot, t));
  }

  function readConfiguredDbPathFromFile() {
    const cfg = configPathAbs();
    if (!fs.existsSync(cfg)) return null;
    try {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (typeof j.databaseFile === 'string' && j.databaseFile.trim()) {
        return normalizeDatabasePath(j.databaseFile);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function resolveStartupDbPath() {
    if (envLocksPath) {
      return {
        dbPath: path.resolve(process.env.SMARTCAT_DB_PATH.trim()),
        resolvedFrom: 'env',
      };
    }
    const fromCfg = readConfiguredDbPathFromFile();
    if (fromCfg) {
      return { dbPath: fromCfg, resolvedFrom: 'config' };
    }
    const def = path.join(projectRoot, 'data', 'smartcat-local.db');
    return { dbPath: def, resolvedFrom: 'default' };
  }

  function writeDbPathConfig(absDbPath) {
    fs.writeFileSync(configPathAbs(), JSON.stringify({ databaseFile: absDbPath }, null, 2), 'utf8');
  }

  function ensureSchema(database) {
    database.exec(SCHEMA_SQL);
  }

  function updateSettingsKvMeta(database) {
    try {
      const cols = database.prepare('PRAGMA table_info(settings_kv)').all();
      const orgCol = cols.find((c) => c.name === 'org_id');
      settingsKvMeta = {
        hasOrgId: Boolean(orgCol),
        orgIdIsInteger: orgCol ? /INT/i.test(String(orgCol.type)) : false,
      };
    } catch {
      settingsKvMeta = { hasOrgId: false, orgIdIsInteger: false };
    }
  }

  function updateDocumentsMeta(database) {
    try {
      const cols = database.prepare('PRAGMA table_info(documents)').all();
      const orgCol = cols.find((c) => c.name === 'org_id');
      documentsMeta = {
        hasOrgId: Boolean(orgCol),
        orgIdIsInteger: orgCol ? /INT/i.test(String(orgCol.type)) : false,
      };
    } catch {
      documentsMeta = { hasOrgId: false, orgIdIsInteger: false };
    }
  }

  function connectSqlite(absPath) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const db = new Database(absPath);
    db.pragma('journal_mode = WAL');
    cachedSettingsOrgId = undefined;
    cachedDocumentsOrgId = undefined;
    ensureSchema(db);
    updateSettingsKvMeta(db);
    updateDocumentsMeta(db);
    return db;
  }

  function resolveOrgIdForWrite() {
    if (!settingsKvMeta.hasOrgId) return undefined;
    if (cachedSettingsOrgId !== undefined) return cachedSettingsOrgId;
    const raw = SETTINGS_ORG_ID_ENV;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const s = String(raw).trim();
      cachedSettingsOrgId = settingsKvMeta.orgIdIsInteger ? Number(s) || 0 : s;
      return cachedSettingsOrgId;
    }
    try {
      const sample = sqlite.prepare('SELECT org_id FROM settings_kv LIMIT 1').get();
      if (sample && sample.org_id !== undefined && sample.org_id !== null) {
        cachedSettingsOrgId = sample.org_id;
        return cachedSettingsOrgId;
      }
    } catch {
      /* ignore */
    }
    cachedSettingsOrgId = settingsKvMeta.orgIdIsInteger ? 0 : '';
    return cachedSettingsOrgId;
  }

  function resolveOrgIdForDocuments() {
    if (!documentsMeta.hasOrgId) return undefined;
    if (settingsKvMeta.hasOrgId) {
      return resolveOrgIdForWrite();
    }
    if (cachedDocumentsOrgId !== undefined) return cachedDocumentsOrgId;
    const raw = SETTINGS_ORG_ID_ENV;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const s = String(raw).trim();
      cachedDocumentsOrgId = documentsMeta.orgIdIsInteger ? Number(s) || 0 : s;
      return cachedDocumentsOrgId;
    }
    try {
      const sample = sqlite.prepare('SELECT org_id FROM documents LIMIT 1').get();
      if (sample && sample.org_id !== undefined && sample.org_id !== null) {
        cachedDocumentsOrgId = sample.org_id;
        return cachedDocumentsOrgId;
      }
    } catch {
      /* ignore */
    }
    cachedDocumentsOrgId = documentsMeta.orgIdIsInteger ? 0 : '';
    return cachedDocumentsOrgId;
  }

  function reopenDatabase(absPath) {
    if (sqlite) {
      try {
        sqlite.prepare('PRAGMA wal_checkpoint(FULL)').run();
      } catch {
        /* ignore */
      }
      sqlite.close();
      sqlite = null;
    }
    dbPath = absPath;
    sqlite = connectSqlite(dbPath);
  }

  function validateSqliteBuffer(buf) {
    if (!buf || buf.length < 512) return false;
    return Buffer.from(buf.subarray(0, 16)).equals(SQLITE_MAGIC);
  }

  function removeWalSidecars(dbFile) {
    for (const suf of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(dbFile + suf);
      } catch {
        /* ignore */
      }
    }
  }

  function getSqliteFileSizes(absDbPath) {
    let dbFileBytes = null;
    let walFileBytes = null;
    try {
      if (absDbPath && fs.existsSync(absDbPath)) {
        dbFileBytes = fs.statSync(absDbPath).size;
      }
    } catch {
      dbFileBytes = null;
    }
    const walPath = absDbPath ? `${absDbPath}-wal` : '';
    try {
      if (walPath && fs.existsSync(walPath)) {
        walFileBytes = fs.statSync(walPath).size;
      }
    } catch {
      walFileBytes = null;
    }
    return { dbFileBytes, walFileBytes };
  }

  const startup = resolveStartupDbPath();
  pathResolvedFrom = startup.resolvedFrom;
  dbPath = startup.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqlite = connectSqlite(dbPath);
  const tmIndex = attachTmIndex(sqlite);

  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS c FROM tm_units').get();
    if (!row?.c) {
      tmIndex.backfillFromCollection((name) => {
        let rows;
        if (documentsMeta.hasOrgId) {
          const oid = resolveOrgIdForDocuments();
          rows = sqlite.prepare('SELECT payload FROM documents WHERE collection = ? AND org_id = ?').all(name, oid);
        } else {
          rows = sqlite.prepare('SELECT payload FROM documents WHERE collection = ?').all(name);
        }
        return rows.map((r) => JSON.parse(r.payload));
      });
    }
  } catch {
    /* ignore backfill errors */
  }

  return {
    mode: 'sqlite',
    pool: null,
    supportsLocalDbAdmin: true,
    get envLocksPath() {
      return envLocksPath;
    },
    get dbPath() {
      return dbPath;
    },
    get configPath() {
      return configPathAbs();
    },
    get pathResolvedFrom() {
      return pathResolvedFrom;
    },
    get settingsKvMeta() {
      return settingsKvMeta;
    },
    get documentsMeta() {
      return documentsMeta;
    },
    resolveOrgIdForWrite,
    resolveOrgIdForDocuments,
    async getHealth() {
      const { dbFileBytes, walFileBytes } = getSqliteFileSizes(dbPath);
      return {
        ok: true,
        dbPath,
        configPath: configPathAbs(),
        envLocked: envLocksPath,
        resolvedFrom: pathResolvedFrom,
        dbFileBytes,
        walFileBytes,
      };
    },
    async getSetting(key) {
      let row;
      if (settingsKvMeta.hasOrgId) {
        const oid = resolveOrgIdForWrite();
        row = sqlite.prepare('SELECT payload FROM settings_kv WHERE org_id = ? AND key = ?').get(oid, key);
        if (!row) {
          row = sqlite.prepare('SELECT payload FROM settings_kv WHERE key = ? LIMIT 1').get(key);
        }
      } else {
        row = sqlite.prepare('SELECT payload FROM settings_kv WHERE key = ?').get(key);
      }
      if (!row) return undefined;
      try {
        return JSON.parse(row.payload);
      } catch {
        return undefined;
      }
    },
    async putSetting(key, value) {
      const payload = JSON.stringify(value);
      if (settingsKvMeta.hasOrgId) {
        const oid = resolveOrgIdForWrite();
        sqlite
          .prepare('INSERT OR REPLACE INTO settings_kv (org_id, key, payload) VALUES (?, ?, ?)')
          .run(oid, key, payload);
      } else {
        sqlite.prepare('INSERT OR REPLACE INTO settings_kv (key, payload) VALUES (?, ?)').run(key, payload);
      }
    },
    async loadCollection(name) {
      let rows;
      if (documentsMeta.hasOrgId) {
        const oid = resolveOrgIdForDocuments();
        rows = sqlite.prepare('SELECT payload FROM documents WHERE collection = ? AND org_id = ?').all(name, oid);
      } else {
        rows = sqlite.prepare('SELECT payload FROM documents WHERE collection = ?').all(name);
      }
      return rows.map((r) => JSON.parse(r.payload));
    },
    async replaceCollection(name, items) {
      if (documentsMeta.hasOrgId) {
        const oid = resolveOrgIdForDocuments();
        const del = sqlite.prepare('DELETE FROM documents WHERE collection = ? AND org_id = ?');
        const ins = sqlite.prepare(
          'INSERT OR REPLACE INTO documents (org_id, collection, id, payload) VALUES (?, ?, ?, ?)'
        );
        const tx = sqlite.transaction((list) => {
          del.run(name, oid);
          for (const item of list) {
            const id = item.id;
            if (!id) throw new Error(`Missing id in ${name} item`);
            ins.run(oid, name, id, JSON.stringify(item));
          }
        });
        tx(items);
        if (name === 'translationMemories') {
          tmIndex.syncTranslationMemories(items);
        }
        return;
      }
      const del = sqlite.prepare('DELETE FROM documents WHERE collection = ?');
      const ins = sqlite.prepare(
        'INSERT OR REPLACE INTO documents (collection, id, payload) VALUES (?, ?, ?)'
      );
      const tx = sqlite.transaction((list) => {
        del.run(name);
        for (const item of list) {
          const id = item.id;
          if (!id) throw new Error(`Missing id in ${name} item`);
          ins.run(name, id, JSON.stringify(item));
        }
      });
      tx(items);
      if (name === 'translationMemories') {
        tmIndex.syncTranslationMemories(items);
      }
    },
    async putXliffBlob(id, buf) {
      sqlite
        .prepare('INSERT OR REPLACE INTO xliff_blobs (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, buf, Date.now());
    },
    async getXliffBlob(id) {
      const row = sqlite.prepare('SELECT payload FROM xliff_blobs WHERE id = ?').get(id);
      return row?.payload ?? null;
    },
    async deleteXliffBlob(id) {
      sqlite.prepare('DELETE FROM xliff_blobs WHERE id = ?').run(id);
    },
    async deleteXliffBlobs(ids) {
      const del = sqlite.prepare('DELETE FROM xliff_blobs WHERE id = ?');
      let n = 0;
      for (const id of ids) {
        if (typeof id === 'string' && id.trim()) {
          del.run(id.trim());
          n += 1;
        }
      }
      return n;
    },
    applyDataStorePath(databaseFile) {
      if (envLocksPath) {
        throw new Error(
          '当前会话已由环境变量 SMARTCAT_DB_PATH 锁定数据库路径，请在系统环境中修改或移除该变量后重启服务。'
        );
      }
      const abs = normalizeDatabasePath(databaseFile);
      writeDbPathConfig(abs);
      reopenDatabase(abs);
      pathResolvedFrom = 'config';
      return { ok: true, dbPath, configPath: configPathAbs() };
    },
    importReplacingDatabase(buffer) {
      if (!validateSqliteBuffer(buffer)) {
        throw new Error('文件不是有效的 SQLite 数据库（请选择由本工具导出或备份的 .db 文件）');
      }
      sqlite.prepare('PRAGMA wal_checkpoint(FULL)').run();
      sqlite.close();
      sqlite = null;

      const backupRename = `${dbPath}.before-import.${Date.now()}`;
      let renamed = false;
      try {
        if (fs.existsSync(dbPath)) {
          fs.renameSync(dbPath, backupRename);
          renamed = true;
        }
        removeWalSidecars(dbPath);
        fs.writeFileSync(dbPath, buffer);
        sqlite = connectSqlite(dbPath);
      } catch (e) {
        if (renamed && fs.existsSync(backupRename)) {
          try {
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
            fs.renameSync(backupRename, dbPath);
          } catch {
            /* ignore */
          }
        }
        sqlite = fs.existsSync(dbPath) ? connectSqlite(dbPath) : null;
        if (!sqlite) throw e;
        throw e;
      }
      return { ok: true, dbPath };
    },
    exportDatabaseStream(res) {
      sqlite.prepare('PRAGMA wal_checkpoint(FULL)').run();
      const rawName = path.basename(dbPath) || 'smartcat-local.db';
      const safeName = rawName.replace(/[^\w.\-()+@]/g, '_') || 'smartcat-local.db';
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      fs.createReadStream(dbPath).pipe(res);
    },
    tmIndex,
  };
}
