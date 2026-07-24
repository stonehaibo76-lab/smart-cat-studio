/**
 * Supervertaler Java Okapi sidecar client (PPTX/XLSX extract/merge on port 8091).
 * DOCX mono uses Python sidecar (8090) for better format preservation.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let javaProc = null;
let javaStarted = false;
let javaSpawnFailed = false;

export const JAVA_OFFICE_OKAPI_EXTENSIONS = ['.pptx', '.xlsx'];

export function isJavaOfficeOkapiFile(fileName) {
  const lower = String(fileName || '').toLowerCase();
  return lower.endsWith('.pptx') || lower.endsWith('.xlsx');
}

/** @deprecated Use isJavaOfficeOkapiFile */
export function isXlsxOkapiFile(fileName) {
  return isJavaOfficeOkapiFile(fileName);
}

export function resolveJavaUpstream(explicitUrl) {
  const raw =
    (explicitUrl && String(explicitUrl).trim()) ||
    process.env.OKAPI_JAVA_UPSTREAM_URL ||
    'http://127.0.0.1:8091';
  return raw.replace(/\/+$/, '');
}

export function sanitizeTranslationForOkapi(text) {
  return String(text ?? '')
    .replace(/<\/?(?:bi|li-[bo]|li)>/gi, '')
    .replace(/<\/?run\d+>/gi, '');
}

export function buildJavaMergeTranslations(segments) {
  const tuGroups = new Map();

  for (const seg of segments) {
    const tuId = String(seg.okapiTuId ?? '').trim();
    const segIdx = seg.okapiSegmentIndex;
    if (!tuId || segIdx == null || segIdx < 0) continue;

    const raw = String(seg.target ?? seg.targetText ?? '').trim() || String(seg.source ?? seg.sourceText ?? '').trim();
    const translation = sanitizeTranslationForOkapi(raw);
    const list = tuGroups.get(tuId) ?? [];
    list.push({ segIdx, translation });
    tuGroups.set(tuId, list);
  }

  const translations = [];
  for (const [tuId, subSegs] of tuGroups) {
    subSegs.sort((a, b) => a.segIdx - b.segIdx);
    const combined = sanitizeTranslationForOkapi(subSegs.map((s) => s.translation).join(' '));
    translations.push({ id: tuId, segmentIndex: 0, translation: combined });
  }
  return translations;
}

export function normalizeJavaExtractSegments(rawSegments) {
  if (!Array.isArray(rawSegments)) return [];

  const out = [];
  for (const seg of rawSegments) {
    const tuId = String(seg.id ?? '').trim();
    const segmentIndex = Number(seg.segmentIndex ?? 0);
    const subDoc = String(seg.subDocument ?? '').toLowerCase();
    const plain = String(seg.source ?? '').trim();
    const tagged = String(seg.sourceWithTags ?? '').trim();
    const display = tagged || plain;

    if (subDoc.startsWith('header') || subDoc.startsWith('footer')) continue;
    if (!display) continue;

    out.push({
      id: `${tuId}__${segmentIndex}`,
      source: display,
      target: '',
      okapiTuId: tuId,
      okapiSegmentIndex: Number.isFinite(segmentIndex) ? segmentIndex : 0,
    });
  }
  return out;
}

function resolveJarPath(projectRoot) {
  const fromEnv = process.env.OKAPI_JAVA_JAR?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const bundled = path.join(projectRoot, 'binaries', 'okapi-java-sidecar', 'okapi-sidecar.jar');
  if (fs.existsSync(bundled)) return bundled;
  return bundled;
}

export function resolveJavaCommand(projectRoot) {
  if (projectRoot) {
    const bundled = path.join(
      projectRoot,
      'runtime',
      'jre',
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    );
    if (fs.existsSync(bundled)) return bundled;
  }
  const home = process.env.JAVA_HOME?.trim();
  if (home) {
    const candidate = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'java';
}

function mergeMimeForFileName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export function startOkapiJavaSidecar(projectRoot) {
  if (javaStarted) return javaProc;
  javaStarted = true;
  javaSpawnFailed = false;

  const jar = resolveJarPath(projectRoot);
  if (!fs.existsSync(jar)) {
    console.error(`[okapi-java] JAR not found: ${jar}`);
    javaStarted = false;
    javaSpawnFailed = true;
    return null;
  }

  const url = new URL(resolveJavaUpstream());
  const port = url.port || '8091';
  const javaCmd = resolveJavaCommand(projectRoot);

  console.log(`[okapi-java] Starting ${javaCmd} -jar ${jar} --port=${port}`);
  javaProc = spawn(javaCmd, ['-jar', jar, `--port=${port}`], {
    stdio: 'inherit',
    env: process.env,
  });

  javaProc.on('error', (err) => {
    console.error('[okapi-java] spawn error:', err);
    javaProc = null;
    javaStarted = false;
    javaSpawnFailed = true;
  });

  javaProc.on('exit', (code, signal) => {
    console.error(`[okapi-java] exited (code=${code}, signal=${signal})`);
    javaProc = null;
    javaStarted = false;
    if (code != null && code !== 0) javaSpawnFailed = true;
  });

  return javaProc;
}

export async function waitForOkapiJavaSidecar(upstream, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (javaSpawnFailed) return false;
    try {
      const res = await fetch(`${upstream}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (payload.status === 'ok' || payload.ok) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function getJavaHealth(upstream) {
  try {
    const res = await fetch(`${upstream}/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const payload = await res.json().catch(() => ({}));
    const ok = payload.status === 'ok' || payload.ok === true;
    return {
      ok,
      officeOkapiSupported: ok,
      supportedExtensions: ok ? ['pptx', 'xlsx'] : [],
      version: payload.version,
      okapiVersion: payload.okapi_version,
      service: payload.service,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function javaExtract(
  upstream,
  fileName,
  buffer,
  sourceLang = 'en',
  targetLang = 'zh',
  segmentationMode = 'sentence'
) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName);
  form.append('source_lang', sourceLang);
  form.append('target_lang', targetLang);
  form.append('segment', segmentationMode === 'sentence' ? 'true' : 'false');

  const res = await fetch(`${upstream}/extract`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(300_000),
  });

  const payload = await res.json().catch(async () => ({
    error: await res.text(),
  }));

  if (!res.ok) {
    const msg =
      payload.message || payload.error || (typeof payload === 'string' ? payload : res.statusText);
    throw new Error(msg || `Java Okapi extract failed (HTTP ${res.status})`);
  }

  const segments = normalizeJavaExtractSegments(payload.segments);
  if (!segments.length) {
    throw new Error(`Java Okapi 未从 ${fileName} 中提取到可译句段`);
  }

  return {
    ok: true,
    segments,
    fileName: payload.filename || fileName,
    filterUsed: payload.filterUsed,
    textUnitCount: payload.textUnitCount,
    segmentCount: payload.segmentCount,
  };
}

function parseMergeFileName(res, fallback) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename="([^"]+)"/i.exec(cd);
  if (m?.[1]) return m[1];
  return fallback;
}

export async function javaMerge(
  upstream,
  fileName,
  buffer,
  segments,
  sourceLang = 'en',
  targetLang = 'zh'
) {
  const translations = buildJavaMergeTranslations(segments);
  if (!translations.length) {
    throw new Error('没有可用于 Okapi merge 的句段（缺少 okapiTuId / okapiSegmentIndex）');
  }

  const form = new FormData();
  form.append('original', new Blob([buffer]), fileName);
  form.append('translations', JSON.stringify(translations));
  form.append('source_lang', sourceLang);
  form.append('target_lang', targetLang);

  const res = await fetch(`${upstream}/merge`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = errText;
    try {
      const j = JSON.parse(errText);
      msg = j.message || j.error || errText;
    } catch {
      /* plain text */
    }
    throw new Error(msg || `Java Okapi merge failed (HTTP ${res.status})`);
  }

  const mergedBuf = Buffer.from(await res.arrayBuffer());
  const stem = fileName.replace(/\.[^.]+$/, '');
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.xlsx';
  const defaultName = `${stem}_译文${ext}`;
  const outName = parseMergeFileName(res, defaultName);

  return {
    ok: true,
    fileName: outName,
    fileBase64: mergedBuf.toString('base64'),
    mime: mergeMimeForFileName(fileName),
  };
}

export async function ensureJavaSidecarReady(projectRoot, upstream) {
  let health = await getJavaHealth(upstream);
  if (health.ok) return health;

  if (process.env.SMARTCAT_SPAWN_OKAPI !== '0') {
    startOkapiJavaSidecar(projectRoot);
    const ready = await waitForOkapiJavaSidecar(upstream, 30_000);
    if (ready) {
      health = await getJavaHealth(upstream);
      if (health.ok) return health;
    }
  }

  throw new Error(
    javaSpawnFailed
      ? 'Java Okapi 侧车启动失败。请安装 Java 17+、运行 scripts\\packaging\\fetch-jre.ps1 安装便携 JRE，或手动执行 scripts\\start-okapi-java-sidecar.cmd'
      : health.error ||
          'Java Okapi 侧车（8091）未就绪。请启动 scripts/start-okapi-java-sidecar.cmd，或重新运行启动脚本。'
  );
}
