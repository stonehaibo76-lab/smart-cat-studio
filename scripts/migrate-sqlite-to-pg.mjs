#!/usr/bin/env node
/**
 * One-time migration: local SQLite → Supabase PostgreSQL
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-pg.mjs [sqlite-path] [org-id]
 *
 * Defaults:
 *   sqlite-path: data/smartcat-local.db
 *   org-id: default
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const sqlitePath = path.resolve(projectRoot, process.argv[2] || 'data/smartcat-local.db');
const orgId = process.argv[3] || process.env.MIGRATE_ORG_ID || 'default';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('请设置 DATABASE_URL 环境变量');
  process.exit(1);
}
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite 文件不存在: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS documents (
  org_id TEXT NOT NULL DEFAULT 'default',
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, collection, id)
);
CREATE TABLE IF NOT EXISTS settings_kv (
  org_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, key)
);
CREATE TABLE IF NOT EXISTS xliff_blobs (
  org_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  payload BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (org_id, id)
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

function tableHasColumn(table, column) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

async function migrateDocuments() {
  const hasOrg = tableHasColumn('documents', 'org_id');
  const rows = hasOrg
    ? sqlite.prepare('SELECT org_id, collection, id, payload FROM documents').all()
    : sqlite.prepare('SELECT collection, id, payload FROM documents').all();
  let n = 0;
  for (const row of rows) {
    const oid = hasOrg ? String(row.org_id) : orgId;
    await pool.query(
      `INSERT INTO documents (org_id, collection, id, payload, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (org_id, collection, id) DO UPDATE SET payload = EXCLUDED.payload`,
      [oid, row.collection, row.id, row.payload]
    );
    n += 1;
  }
  return n;
}

async function migrateSettings() {
  const hasOrg = tableHasColumn('settings_kv', 'org_id');
  const rows = hasOrg
    ? sqlite.prepare('SELECT org_id, key, payload FROM settings_kv').all()
    : sqlite.prepare('SELECT key, payload FROM settings_kv').all();
  let n = 0;
  for (const row of rows) {
    const oid = hasOrg ? String(row.org_id) : orgId;
    await pool.query(
      `INSERT INTO settings_kv (org_id, key, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (org_id, key) DO UPDATE SET payload = EXCLUDED.payload`,
      [oid, row.key, row.payload]
    );
    n += 1;
  }
  return n;
}

async function migrateBlobs() {
  const hasOrg = tableHasColumn('xliff_blobs', 'org_id');
  const rows = hasOrg
    ? sqlite.prepare('SELECT org_id, id, payload, created_at FROM xliff_blobs').all()
    : sqlite.prepare('SELECT id, payload, created_at FROM xliff_blobs').all();
  let n = 0;
  for (const row of rows) {
    const oid = hasOrg ? String(row.org_id) : orgId;
    await pool.query(
      `INSERT INTO xliff_blobs (org_id, id, payload, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, id) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [oid, row.id, row.payload, row.created_at]
    );
    n += 1;
  }
  return n;
}

try {
  await pool.query(SCHEMA_SQL);
  console.log(`Migrating ${sqlitePath} → PostgreSQL (org_id=${orgId})`);
  const docs = await migrateDocuments();
  const settings = await migrateSettings();
  const blobs = await migrateBlobs();
  console.log(`Done: documents=${docs}, settings_kv=${settings}, xliff_blobs=${blobs}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await pool.end();
}
