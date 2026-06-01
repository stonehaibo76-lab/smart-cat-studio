import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSqliteStore } from './sqliteStore.mjs';
import { createPgStore } from './pgStore.mjs';
import {
  isCloudMode,
  registerAuthRoutes,
  maybeRequireAuth,
  maybeRequireWrite,
} from './auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || process.env.SMARTCAT_LOCAL_DB_PORT || 58741);
const cloud = isCloudMode();

async function createStore() {
  if (cloud) {
    return createPgStore(process.env.DATABASE_URL.trim());
  }
  return createSqliteStore(projectRoot);
}

const store = await createStore();

const app = express();

const corsOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean)
  : true;
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

if (cloud && store.pool) {
  app.use('/api/auth', express.json({ limit: '1mb' }));
  registerAuthRoutes(app, store.pool);
}

app.get('/api/health', async (_req, res) => {
  try {
    const health = await store.getHealth();
    res.json({ ...health, cloudMode: cloud });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/', (_req, res) => {
  res
    .status(200)
    .type('text/plain; charset=utf-8')
    .send(
      cloud
        ? 'SmartCAT Cloud API is running. Use /api/health to verify connectivity.'
        : 'SmartCAT local DB API is running. Use /api/health to verify connectivity.'
    );
});

if (store.supportsLocalDbAdmin) {
  app.put(
    '/api/import-database',
    maybeRequireAuth,
    express.raw({ limit: '500mb', type: 'application/octet-stream' }),
    async (req, res) => {
      try {
        const buf = req.body;
        if (!Buffer.isBuffer(buf) || buf.length === 0) {
          res.status(400).json({ error: '请求体为空' });
          return;
        }
        const result = store.importReplacingDatabase(buf);
        console.log(`SmartCAT SQLite imported into: ${result.dbPath}`);
        res.json(result);
      } catch (e) {
        console.error(e);
        res.status(400).json({ error: String(e.message || e) });
      }
    }
  );
}

app.put(
  '/api/xliff-blobs/:id',
  maybeRequireAuth,
  maybeRequireWrite,
  express.raw({ type: '*/*', limit: '200mb' }),
  async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) {
        res.status(400).json({ error: 'Missing blob id' });
        return;
      }
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      await store.putXliffBlob(id, buf, req);
      res.json({ ok: true, id, size: buf.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);

app.use(express.json({ limit: '80mb', strict: false }));

if (store.supportsLocalDbAdmin) {
  app.get('/api/data-store', (_req, res) => {
    res.json({
      dbPath: store.dbPath,
      configPath: store.configPath,
      envLocked: store.envLocksPath,
      resolvedFrom: store.pathResolvedFrom,
    });
  });

  app.get('/api/export-database', maybeRequireAuth, (_req, res) => {
    try {
      store.exportDatabaseStream(res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post('/api/data-store', maybeRequireAuth, maybeRequireWrite, async (req, res) => {
    try {
      const raw = req.body?.databaseFile ?? req.body?.path;
      const result = store.applyDataStorePath(raw);
      console.log(`SmartCAT SQLite path updated: ${result.dbPath}`);
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message || e) });
    }
  });
} else {
  app.get('/api/data-store', maybeRequireAuth, (_req, res) => {
    res.json({
      dbPath: 'postgresql',
      configPath: '',
      envLocked: true,
      resolvedFrom: 'cloud',
    });
  });
}

app.get('/api/load-all', maybeRequireAuth, async (req, res) => {
  try {
    const omit = new Set(
      String(req.query.omit ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const initialized = (await store.getSetting('db-initialized', req)) === true;
    const payload = {
      initialized,
      projects: await store.loadCollection('projects', req),
      termBases: await store.loadCollection('termbases', req),
      translationMemories: await store.loadCollection('translationMemories', req),
      twinTranslators: omit.has('twins') ? [] : await store.loadCollection('twinTranslators', req),
      knowledgeBases: omit.has('knowledge') ? [] : await store.loadCollection('knowledgeBases', req),
      grammarRuleBooks: await store.loadCollection('grammarRuleBooks', req),
      regexDictionaryBooks: await store.loadCollection('regexDictionaryBooks', req),
      aiSettings: (await store.getSetting('ai-settings', req)) ?? null,
      editorSettings: (await store.getSetting('editor-settings', req)) ?? null,
      quickPrompts: (await store.getSetting('quick-prompts', req)) ?? null,
      favoriteUrls: (await store.getSetting('favorite-urls', req)) ?? null,
      customOnlineDictionaries: (await store.getSetting('custom-online-dictionaries', req)) ?? null,
      embeddingSettings: (await store.getSetting('embedding-settings', req)) ?? null,
      welcomeCompleted: (await store.getSetting('welcome-completed', req)) === true,
      skipStartupScreen: (await store.getSetting('skip-startup-screen', req)) === true,
    };
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

function putCollectionRoute(routePath, collectionName) {
  app.put(routePath, maybeRequireAuth, maybeRequireWrite, async (req, res) => {
    try {
      if (!Array.isArray(req.body)) {
        res.status(400).json({ error: 'Expected JSON array' });
        return;
      }
      await store.replaceCollection(collectionName, req.body, req);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}

app.get('/api/twin-translators', maybeRequireAuth, async (req, res) => {
  try {
    res.json(await store.loadCollection('twinTranslators', req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/knowledge-bases', maybeRequireAuth, async (req, res) => {
  try {
    res.json(await store.loadCollection('knowledgeBases', req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

putCollectionRoute('/api/projects', 'projects');
putCollectionRoute('/api/term-bases', 'termbases');
putCollectionRoute('/api/translation-memories', 'translationMemories');
putCollectionRoute('/api/twin-translators', 'twinTranslators');
putCollectionRoute('/api/knowledge-bases', 'knowledgeBases');
putCollectionRoute('/api/grammar-rule-books', 'grammarRuleBooks');
putCollectionRoute('/api/regex-dictionary-books', 'regexDictionaryBooks');

app.get('/api/settings/:key', maybeRequireAuth, async (req, res) => {
  try {
    const v = await store.getSetting(req.params.key, req);
    if (v === undefined) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(v);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/settings/:key', maybeRequireAuth, maybeRequireWrite, async (req, res) => {
  try {
    await store.putSetting(req.params.key, req.body, req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/xliff-blobs/:id', maybeRequireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const payload = await store.getXliffBlob(id, req);
    if (!payload) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete('/api/xliff-blobs/:id', maybeRequireAuth, maybeRequireWrite, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    await store.deleteXliffBlob(id, req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/xliff-blobs/delete-many', maybeRequireAuth, maybeRequireWrite, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      res.json({ ok: true, deleted: 0 });
      return;
    }
    const n = await store.deleteXliffBlobs(ids, req);
    res.json({ ok: true, deleted: n });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const host =
  cloud || process.env.SMARTCAT_BIND_ALL === '1' || process.env.NODE_ENV === 'production'
    ? '0.0.0.0'
    : '127.0.0.1';

const server = http.createServer(app);
server.listen(PORT, host, () => {
  const mode = cloud ? 'Cloud (PostgreSQL)' : 'Local (SQLite)';
  console.log(`SmartCAT API [${mode}] http://${host === '0.0.0.0' ? 'localhost' : host}:${PORT}`);
  if (!cloud && store.dbPath) {
    console.log(`SQLite file: ${store.dbPath}`);
    if (store.settingsKvMeta?.hasOrgId) {
      console.log(
        `settings_kv 含 org_id 列：写入将使用 org_id=${JSON.stringify(store.resolveOrgIdForWrite())}`
      );
    }
    if (store.documentsMeta?.hasOrgId) {
      console.log(
        `documents 含 org_id 列：集合读写将使用 org_id=${JSON.stringify(store.resolveOrgIdForDocuments())}`
      );
    }
    if (store.envLocksPath) console.log('DB path locked by SMARTCAT_DB_PATH');
    else console.log(`Config file (optional): ${store.configPath}`);
  }
  if (cloud) {
    console.log('Cloud mode: JWT auth required for data routes');
    if (process.env.FRONTEND_URL) console.log(`CORS allowed origin(s): ${process.env.FRONTEND_URL}`);
  }
});
