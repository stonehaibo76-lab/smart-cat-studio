import fs from 'fs';
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
import { startOkapiSidecar, waitForOkapiSidecar } from './okapiSidecar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || process.env.SMARTCAT_LOCAL_DB_PORT || 58741);
const cloud = isCloudMode();
const serveStatic = process.env.SMARTCAT_SERVE_STATIC === '1';
const distDir = process.env.SMARTCAT_DIST_DIR?.trim() || path.join(projectRoot, 'dist');

const PORTABLE_MT_DEFAULTS = {
  enabled: true,
  serviceUrl: 'http://127.0.0.1:8770',
  defaultTranslator: 'youdao',
  enabledTranslators: [
    'cloudTranslation', 'google', 'iciba', 'iflyrec', 'itranslate', 'lara', 'lingvanex', 'modernMt',
    'papago', 'qqTranSmart', 'reverso', 'sogou', 'sysTran', 'translateCom', 'xunjie', 'yandex', 'youdao',
  ],
  autoLookupOnSegmentChange: true,
  compareMode: false,
  compareTranslators: ['youdao', 'cloudTranslation', 'sogou', 'qqTranSmart'],
  engineCatalogVersion: 3,
  disableStartupPreaccelerate: true,
};

async function createStore() {
  if (cloud) {
    return createPgStore(process.env.DATABASE_URL.trim());
  }
  return createSqliteStore(projectRoot);
}

const store = await createStore();

async function bootstrapPortableDefaults() {
  if (cloud || process.env.SMARTCAT_PACKAGE_MODE !== 'portable' || !store.putSetting) return;
  const existing = await store.getSetting('mt-reference-settings');
  if (existing != null) return;
  await store.putSetting('mt-reference-settings', PORTABLE_MT_DEFAULTS);
  console.log('Portable bootstrap: enabled MT reference defaults (8770)');
}

await bootstrapPortableDefaults();

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
    const payload = { ...health, cloudMode: cloud };
    if (cloud) {
      payload.okapi = await getOkapiHealthSummary();
    }
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

if (!serveStatic) {
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
}

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
      mtReferenceSettings: (await store.getSetting('mt-reference-settings', req)) ?? null,
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

// --- Local LLM proxy (llama-server OpenAI-compatible API) ---
const LOCAL_LLM_TIMEOUT_MS = 180_000;

function normalizeLlmBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function assertLocalUpstream(baseUrl) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error('upstreamBaseUrl 无效');
  }
  const host = u.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('upstreamBaseUrl 仅允许 localhost / 127.0.0.1');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('upstreamBaseUrl 须为 http 或 https 协议');
  }
  let normalized = normalizeLlmBaseUrl(baseUrl);
  if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}

function localLlmAuthHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

app.get('/api/local-llm/health', async (req, res) => {
  try {
    const upstream = assertLocalUpstream(
      String(req.query.upstream || 'http://127.0.0.1:8080/v1')
    );
    const apiKey = req.query.apiKey ? String(req.query.apiKey) : undefined;
    const headers = localLlmAuthHeaders(apiKey);

    const modelsRes = await fetch(`${upstream}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (modelsRes.ok) {
      res.json({ ok: true });
      return;
    }

    const chatRes = await fetch(`${upstream}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'local',
        messages: [{ role: 'user', content: 'OK' }],
        max_tokens: 8,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!chatRes.ok) {
      const t = await chatRes.text();
      res.status(502).json({ ok: false, error: `llama-server ${chatRes.status}: ${t}` });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/local-llm/chat/completions', async (req, res) => {
  try {
    const body = req.body || {};
    const { upstreamBaseUrl, apiKey, ...payload } = body;
    const upstream = assertLocalUpstream(upstreamBaseUrl || 'http://127.0.0.1:8080/v1');
    const chatRes = await fetch(`${upstream}/chat/completions`, {
      method: 'POST',
      headers: localLlmAuthHeaders(apiKey || undefined),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LOCAL_LLM_TIMEOUT_MS),
    });
    const text = await chatRes.text();
    res.status(chatRes.status).type('application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// --- MT reference proxy (translators Python sidecar) ---
const MT_REFERENCE_TIMEOUT_MS = 35_000;

function normalizeServiceBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function assertLocalServiceUrl(baseUrl) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error('upstreamBaseUrl 无效');
  }
  const host = u.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('upstreamBaseUrl 仅允许 localhost / 127.0.0.1');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('upstreamBaseUrl 须为 http 或 https 协议');
  }
  return normalizeServiceBaseUrl(baseUrl);
}

/** Cloud: server env only (SSRF-safe). Local: client serviceUrl with localhost guard. */
function resolveOkapiUpstream(clientServiceUrl) {
  if (cloud) {
    const url = (process.env.OKAPI_UPSTREAM_URL || 'http://127.0.0.1:8090').trim();
    return normalizeServiceBaseUrl(url);
  }
  return assertLocalServiceUrl(String(clientServiceUrl || 'http://127.0.0.1:8090'));
}

async function getOkapiHealthSummary() {
  try {
    const upstream = resolveOkapiUpstream();
    const healthRes = await fetch(`${upstream}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await healthRes.json().catch(() => ({}));
    return {
      ok: !!payload.ok,
      version: payload.version,
      error: payload.error,
      mergeSupported: payload.mergeSupported !== false,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), mergeSupported: false };
  }
}

function mtReferenceAuthHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

app.get('/api/mt-reference/health', async (req, res) => {
  if (cloud) {
    res.status(503).json({ ok: false, error: '云端版不支持 MT 参考服务' });
    return;
  }
  try {
    const upstream = assertLocalServiceUrl(
      String(req.query.upstream || 'http://127.0.0.1:8770')
    );
    const apiKey = req.query.apiKey ? String(req.query.apiKey) : undefined;
    const healthRes = await fetch(`${upstream}/health`, {
      method: 'GET',
      headers: mtReferenceAuthHeaders(apiKey),
      signal: AbortSignal.timeout(10_000),
    });
    if (!healthRes.ok) {
      const t = await healthRes.text();
      res.status(502).json({ ok: false, error: `sidecar ${healthRes.status}: ${t}` });
      return;
    }
    const data = await healthRes.json();
    res.json({
      ok: !!data.ok,
      translatorsVersion: data.translators_version || data.translatorsVersion,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/mt-reference/translate', async (req, res) => {
  if (cloud) {
    res.status(503).json({ ok: false, error: '云端版不支持 MT 参考服务' });
    return;
  }
  try {
    const body = req.body || {};
    const {
      upstreamBaseUrl,
      apiKey,
      text,
      translator,
      from_language: fromLanguage,
      to_language: toLanguage,
    } = body;
    const upstream = assertLocalServiceUrl(upstreamBaseUrl || 'http://127.0.0.1:8770');
    const translateRes = await fetch(`${upstream}/translate`, {
      method: 'POST',
      headers: mtReferenceAuthHeaders(apiKey || undefined),
      body: JSON.stringify({
        text: String(text || ''),
        translator: String(translator || 'bing'),
        from_language: String(fromLanguage || 'auto'),
        to_language: String(toLanguage || 'en'),
      }),
      signal: AbortSignal.timeout(MT_REFERENCE_TIMEOUT_MS),
    });
    const payload = await translateRes.json().catch(async () => ({
      ok: false,
      error: await translateRes.text(),
    }));
    if (!translateRes.ok) {
      res.status(translateRes.status).json({
        ok: false,
        error: payload.detail || payload.error || `sidecar ${translateRes.status}`,
      });
      return;
    }
    res.json({
      ok: !!payload.ok,
      text: payload.text,
      translator: payload.translator,
      elapsed_ms: payload.elapsed_ms,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// --- TM indexed search (SQLite local mode) ---
app.post('/api/tm/search', maybeRequireAuth, async (req, res) => {
  try {
    if (!store.tmIndex?.searchTmMatches) {
      res.status(501).json({ error: 'TM search not available in cloud mode yet' });
      return;
    }
    const body = req.body || {};
    const tmIds = Array.isArray(body.tmIds) ? body.tmIds.map(String).filter(Boolean) : [];
    const sourceText = String(body.sourceText || '');
    const minScore = Number(body.minScore) || 50;
    const limit = Math.min(Number(body.limit) || 20, 50);
    const tmNames = body.tmNames && typeof body.tmNames === 'object' ? body.tmNames : {};
    const hits = store.tmIndex.searchTmMatches({ tmIds, sourceText, minScore, limit, tmNames });
    res.json({ ok: true, hits });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Okapi sidecar proxy ---
const OKAPI_TIMEOUT_MS = 300_000;

function buildMergedFileName(fileName, headerName) {
  if (headerName) return headerName;
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.docx';
  return `${fileName.replace(/\.[^.]+$/, '')}_译文${ext}`;
}

async function okapiMergeBuffer(upstream, fileName, buf, segments, exportFont, pptxFontScale) {
  if (cloud) {
    const ready = await waitForOkapiSidecar(upstream, 30_000);
    if (!ready) {
      const err = new Error('Okapi 侧车未就绪，请等待约 1 分钟后重试，或查看 Render 日志中 [okapi-sidecar] 启动信息。');
      err.status = 503;
      throw err;
    }
  }
  const form = new FormData();
  form.append('file', new Blob([buf]), fileName);
  form.append('segments_json', JSON.stringify(segments));
  form.append('export_font', String(exportFont || 'simsun').trim());
  if (pptxFontScale != null && pptxFontScale !== '') {
    form.append('pptx_font_scale', String(pptxFontScale));
  }
  const mergeRes = await fetch(`${upstream}/merge`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(OKAPI_TIMEOUT_MS),
  });
  if (!mergeRes.ok) {
    const errPayload = await mergeRes.json().catch(async () => ({
      error: await mergeRes.text(),
    }));
    const err = new Error(errPayload.error || mergeRes.statusText || 'merge failed');
    err.status = mergeRes.status;
    throw err;
  }
  const mergedBuf = Buffer.from(await mergeRes.arrayBuffer());
  const b64Name = mergeRes.headers.get('x-smartcat-file-name-b64');
  let outName = mergeRes.headers.get('x-smartcat-file-name') || '';
  if (b64Name) {
    try {
      outName = Buffer.from(b64Name, 'base64').toString('utf8');
    } catch {
      /* keep ascii header */
    }
  }
  return {
    ok: true,
    fileName: buildMergedFileName(fileName, outName),
    fileBase64: mergedBuf.toString('base64'),
    mime: mergeRes.headers.get('content-type') || 'application/octet-stream',
  };
}

app.get('/api/okapi/health', async (req, res) => {
  try {
    const upstream = resolveOkapiUpstream(req.query.serviceUrl);
    let healthRes = await fetch(`${upstream}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if ((!healthRes || !healthRes.ok) && cloud && process.env.SMARTCAT_SPAWN_OKAPI !== '0') {
      startOkapiSidecar(projectRoot);
      await waitForOkapiSidecar(upstream, 20_000);
      healthRes = await fetch(`${upstream}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
    }

    if (!healthRes || !healthRes.ok) {
      res.status(502).json({
        ok: false,
        error: healthRes ? `sidecar HTTP ${healthRes.status}` : 'fetch failed',
        hint: cloud
          ? 'Okapi 侧车未在容器内监听 8090。请查看 Render 日志中 [render-start] 行。'
          : undefined,
      });
      return;
    }

    const payload = await healthRes.json().catch(() => ({}));
    res.json({
      ok: !!payload.ok,
      version: payload.version,
      error: payload.error,
      mergeSupported: payload.mergeSupported !== false,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/okapi/extract', maybeRequireAuth, maybeRequireWrite, express.json({ limit: '120mb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const upstream = resolveOkapiUpstream(body.serviceUrl);
    const fileName = String(body.fileName || 'document');
    const fileBase64 = String(body.fileBase64 || '');
    if (!fileBase64) {
      res.status(400).json({ ok: false, error: 'fileBase64 required' });
      return;
    }
    const buf = Buffer.from(fileBase64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buf]), fileName);
    const extractRes = await fetch(`${upstream}/extract`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(OKAPI_TIMEOUT_MS),
    });
    const payload = await extractRes.json().catch(async () => ({
      ok: false,
      error: await extractRes.text(),
    }));
    if (!extractRes.ok) {
      res.status(extractRes.status).json({ ok: false, error: payload.error || payload.detail });
      return;
    }
    res.json(payload);
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/okapi/merge', maybeRequireAuth, maybeRequireWrite, express.json({ limit: '120mb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const upstream = resolveOkapiUpstream(body.serviceUrl);
    const fileName = String(body.fileName || 'document');
    const fileBase64 = String(body.fileBase64 || '');
    const segments = Array.isArray(body.segments) ? body.segments : [];
    if (!fileBase64) {
      res.status(400).json({ ok: false, error: 'fileBase64 required' });
      return;
    }
    if (segments.length === 0) {
      res.status(400).json({ ok: false, error: 'segments required' });
      return;
    }
    const buf = Buffer.from(fileBase64, 'base64');
    const result = await okapiMergeBuffer(
      upstream,
      fileName,
      buf,
      segments,
      body.exportFont,
      body.pptxFontScale
    );
    res.json(result);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    res.status(status).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/okapi/merge-by-blob', maybeRequireAuth, maybeRequireWrite, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const body = req.body || {};
    const sourceBlobId = String(body.sourceBlobId || '').trim();
    const fileName = String(body.fileName || 'document');
    const segments = Array.isArray(body.segments) ? body.segments : [];
    if (!sourceBlobId) {
      res.status(400).json({ ok: false, error: 'sourceBlobId required' });
      return;
    }
    if (segments.length === 0) {
      res.status(400).json({ ok: false, error: 'segments required' });
      return;
    }
    const blob = await store.getXliffBlob(sourceBlobId, req);
    if (!blob) {
      res.status(404).json({ ok: false, error: '原文件备份未找到，请重新导入文档后再导出。' });
      return;
    }
    const upstream = resolveOkapiUpstream();
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    const result = await okapiMergeBuffer(
      upstream,
      fileName,
      buf,
      segments,
      body.exportFont,
      body.pptxFontScale
    );
    res.json(result);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    res.status(status).json({ ok: false, error: String(e.message || e) });
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

if (serveStatic) {
  if (!fs.existsSync(distDir)) {
    console.error(`SMARTCAT_SERVE_STATIC=1 but dist folder not found: ${distDir}`);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
    console.log(`Serving static UI from: ${distDir}`);
  }
}

const host =
  cloud || process.env.SMARTCAT_BIND_ALL === '1'
    ? '0.0.0.0'
    : '127.0.0.1';

const server = http.createServer(app);

if (cloud && process.env.SMARTCAT_SPAWN_OKAPI !== '0') {
  startOkapiSidecar(projectRoot);
}

server.listen(PORT, host, () => {
  const mode = cloud ? 'Cloud (PostgreSQL)' : 'Local (SQLite)';
  const uiNote = serveStatic ? ' + static UI' : '';
  console.log(`SmartCAT API [${mode}${uiNote}] http://${host === '0.0.0.0' ? 'localhost' : host}:${PORT}`);
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
