import pg from 'pg';

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

export async function createPgStore(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  await pool.query(SCHEMA_SQL);

  function orgId(req) {
    return req?.orgId || 'default';
  }

  return {
    pool,
    mode: 'postgres',
    async getHealth() {
      await pool.query('SELECT 1');
      return {
        ok: true,
        dbPath: 'postgresql',
        configPath: '',
        envLocked: true,
        resolvedFrom: 'cloud',
        dbFileBytes: null,
        walFileBytes: null,
      };
    },
    async getSetting(key, req) {
      const oid = orgId(req);
      const r = await pool.query(
        'SELECT payload FROM settings_kv WHERE org_id = $1 AND key = $2',
        [oid, key]
      );
      if (!r.rows[0]) return undefined;
      return r.rows[0].payload;
    },
    async putSetting(key, value, req) {
      const oid = orgId(req);
      await pool.query(
        `INSERT INTO settings_kv (org_id, key, payload, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (org_id, key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [oid, key, JSON.stringify(value)]
      );
    },
    async loadCollection(name, req) {
      const oid = orgId(req);
      const r = await pool.query(
        'SELECT payload FROM documents WHERE collection = $1 AND org_id = $2',
        [name, oid]
      );
      return r.rows.map((row) => row.payload);
    },
    async replaceCollection(name, items, req) {
      const oid = orgId(req);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM documents WHERE collection = $1 AND org_id = $2', [
          name,
          oid,
        ]);
        for (const item of items) {
          const id = item.id;
          if (!id) throw new Error(`Missing id in ${name} item`);
          await client.query(
            `INSERT INTO documents (org_id, collection, id, payload, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, now())
             ON CONFLICT (org_id, collection, id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
            [oid, name, id, JSON.stringify(item)]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async putXliffBlob(id, buf, req) {
      const oid = orgId(req);
      await pool.query(
        `INSERT INTO xliff_blobs (org_id, id, payload, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, id) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
        [oid, id, buf, Date.now()]
      );
    },
    async getXliffBlob(id, req) {
      const oid = orgId(req);
      const r = await pool.query(
        'SELECT payload FROM xliff_blobs WHERE org_id = $1 AND id = $2',
        [oid, id]
      );
      return r.rows[0]?.payload ?? null;
    },
    async deleteXliffBlob(id, req) {
      const oid = orgId(req);
      await pool.query('DELETE FROM xliff_blobs WHERE org_id = $1 AND id = $2', [oid, id]);
    },
    async deleteXliffBlobs(ids, req) {
      const oid = orgId(req);
      let n = 0;
      for (const id of ids) {
        if (typeof id === 'string' && id.trim()) {
          await pool.query('DELETE FROM xliff_blobs WHERE org_id = $1 AND id = $2', [
            oid,
            id.trim(),
          ]);
          n += 1;
        }
      }
      return n;
    },
    supportsLocalDbAdmin: false,
  };
}
