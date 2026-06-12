/**
 * Assemble Smart-CAT Studio Windows portable zip (self-contained Node + Python).
 * Run on Windows x64: npm run build:portable
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'portable-manifest.json'), 'utf8')
);
const CACHE_DIR = path.join(PROJECT_ROOT, '.pack-cache');
const RELEASE_DIR = path.join(PROJECT_ROOT, 'release');
const STAGING = path.join(RELEASE_DIR, MANIFEST.stagingFolderName);
const FORCE_FRESH_NPM = process.argv.includes('--fresh');

const NPM_MARKERS = [
  'node_modules/vite/package.json',
  'node_modules/better-sqlite3/package.json',
  'node_modules/express/package.json',
  'node_modules/@esbuild/win32-x64/esbuild.exe',
];

function log(msg) {
  console.log(`[pack] ${msg}`);
}

function warn(msg) {
  console.warn(`[pack] WARN: ${msg}`);
}

function hasUsableNodeModules(root = PROJECT_ROOT) {
  return NPM_MARKERS.every((rel) => fs.existsSync(path.join(root, rel)));
}

function isCloudSyncPath() {
  const normalized = PROJECT_ROOT.replace(/\//g, '\\').toLowerCase();
  return /baidusyncdisk|onedrive|dropbox|icloud/i.test(normalized);
}

function ensureNpmDependencies() {
  if (!FORCE_FRESH_NPM && hasUsableNodeModules()) {
    log('node_modules 已就绪，跳过 npm ci（避免云同步目录 EPERM 锁文件）。');
    log('如需强制重装依赖，请先关闭 dev 服务后执行: npm run build:portable -- --fresh');
    return;
  }

  if (isCloudSyncPath()) {
    warn('项目位于云同步目录，npm ci 可能因 esbuild.exe 被锁定而失败。');
    warn('建议：关闭 Smart-CAT / Vite 开发服务，或暂停该文件夹同步后再打包。');
  }

  if (FORCE_FRESH_NPM) {
    log('Running npm ci (--fresh)…');
    run('npm.cmd ci');
    return;
  }

  if (hasUsableNodeModules()) {
    return;
  }

  log('node_modules 不完整，尝试 npm install（非破坏性）…');
  const ok = run('npm.cmd install', { allowFail: true });
  if (!ok && !hasUsableNodeModules()) {
    throw new Error('npm install 失败且 node_modules 不可用。请关闭 dev 服务后重试，或使用 --fresh。');
  }
  if (!ok && hasUsableNodeModules()) {
    warn('npm install 报错但 node_modules 仍可用，继续打包。');
  }
}

function stashBetterSqlite3Build(root) {
  const buildDir = path.join(root, 'node_modules', 'better-sqlite3', 'build');
  if (!fs.existsSync(buildDir)) return;
  const backup = `${buildDir}.bak-${Date.now()}`;
  try {
    fs.renameSync(buildDir, backup);
    log(`Renamed locked better-sqlite3/build -> ${path.basename(backup)}`);
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : '';
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      throw new Error(
        'better-sqlite3/build 被占用无法重建。请关闭 npm run server / npm run dev 及占用 SQLite 的进程后重试。'
      );
    }
    throw err;
  }
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: opts.cwd || PROJECT_ROOT, env: opts.env || process.env, shell: true });
  } catch (err) {
    if (opts.allowFail) return false;
    throw err;
  }
  return true;
}

function findPythonEmbedRoot() {
  const pythonDir = path.join(CACHE_DIR, `python-${MANIFEST.pythonVersion}-embed-amd64`);
  if (fs.existsSync(path.join(pythonDir, 'python.exe'))) return pythonDir;
  return null;
}

const PYTHON_EMBED_FILE = /^(python\d*\.(exe|dll|zip|cat|_pth)|pythonw\.exe|python3\.dll|.*\.pyd|lib(crypto|ssl|ffi)-.*\.dll|sqlite3\.dll|vcruntime.*\.dll|LICENSE\.txt)$/i;

function normalizePythonEmbedLayout() {
  const pythonDir = path.join(CACHE_DIR, `python-${MANIFEST.pythonVersion}-embed-amd64`);
  if (fs.existsSync(path.join(pythonDir, 'python.exe'))) return pythonDir;

  const flatPythonExe = path.join(CACHE_DIR, 'python.exe');
  if (!fs.existsSync(flatPythonExe)) return pythonDir;

  log('Migrating flat Python embed files into dedicated folder…');
  fs.mkdirSync(pythonDir, { recursive: true });
  for (const entry of fs.readdirSync(CACHE_DIR, { withFileTypes: true })) {
    const name = entry.name;
    if (name === path.basename(pythonDir)) continue;
    if (entry.isDirectory() && (name === 'Lib' || name === 'Scripts')) {
      copyDirFiltered(path.join(CACHE_DIR, name), path.join(pythonDir, name));
      rmDirSafe(path.join(CACHE_DIR, name));
      continue;
    }
    if (entry.isFile() && PYTHON_EMBED_FILE.test(name)) {
      fs.copyFileSync(path.join(CACHE_DIR, name), path.join(pythonDir, name));
      fs.unlinkSync(path.join(CACHE_DIR, name));
    }
  }
  return pythonDir;
}

function resolvePythonPthFile(pythonDir) {
  const parts = MANIFEST.pythonVersion.split('.');
  const tag = `${parts[0]}${parts[1]}`;
  const candidates = [
    path.join(pythonDir, `python${tag}._pth`),
    ...fs.readdirSync(pythonDir).filter((n) => /^\d+\._pth$/.test(n) || n.endsWith('._pth')).map((n) => path.join(pythonDir, n)),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function downloadFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    log(`cache hit: ${path.basename(dest)}`);
    return;
  }
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zipEsc = zipPath.replace(/'/g, "''");
  const destEsc = destDir.replace(/'/g, "''");
  run(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipEsc}' -DestinationPath '${destEsc}' -Force"`
  );
}

function rmDirSafe(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDirFiltered(src, dest, { excludeDirNames = [] } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeDirNames.includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirFiltered(from, to, { excludeDirNames });
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function mergePythonRequirements() {
  const okapiReq = path.join(PROJECT_ROOT, 'scripts/okapi-sidecar/requirements.txt');
  const mtReq = path.join(PROJECT_ROOT, 'scripts/translators-server/requirements.txt');
  const lines = new Set();
  for (const file of [okapiReq, mtReq]) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) lines.add(t);
    }
  }
  const merged = path.join(CACHE_DIR, 'portable-python-requirements.txt');
  fs.writeFileSync(merged, `${[...lines].join('\n')}\n`, 'utf8');
  return merged;
}

function setupPythonEmbed(pythonDir) {
  const pthFile = resolvePythonPthFile(pythonDir);
  if (!pthFile) {
    throw new Error(`Python _pth not found under: ${pythonDir}`);
  }
  let pth = fs.readFileSync(pthFile, 'utf8');
  pth = pth.replace('#import site', 'import site');
  if (!/Lib[/\\]site-packages/i.test(pth)) {
    pth = `${pth.trimEnd()}\nLib/site-packages\n`;
  }
  fs.writeFileSync(pthFile, pth, 'utf8');
  fs.mkdirSync(path.join(pythonDir, 'Lib', 'site-packages'), { recursive: true });

  const pythonExe = path.join(pythonDir, 'python.exe');
  const getPip = path.join(CACHE_DIR, 'get-pip.py');
  run(`"${pythonExe}" "${getPip}" --no-warn-script-location`);
  const mergedReq = mergePythonRequirements();
  run(`"${pythonExe}" -m pip install -r "${mergedReq}" --no-warn-script-location`);
}

function ensureEmbeddedNode() {
  const zipName = `node-v${MANIFEST.nodeVersion}-win-x64.zip`;
  const zipPath = path.join(CACHE_DIR, zipName);
  const extractRoot = path.join(CACHE_DIR, `node-v${MANIFEST.nodeVersion}-win-x64`);
  if (!fs.existsSync(path.join(extractRoot, 'node.exe'))) {
    return downloadFile(MANIFEST.nodeUrl, zipPath).then(() => {
      rmDirSafe(extractRoot);
      extractZip(zipPath, CACHE_DIR);
    });
  }
  return Promise.resolve();
}

function ensureEmbeddedPython() {
  const zipName = `python-${MANIFEST.pythonVersion}-embed-amd64.zip`;
  const zipPath = path.join(CACHE_DIR, zipName);
  const pythonDir = path.join(CACHE_DIR, `python-${MANIFEST.pythonVersion}-embed-amd64`);
  const getPip = path.join(CACHE_DIR, 'get-pip.py');

  return (async () => {
    let resolvedPythonDir = findPythonEmbedRoot();
    if (!resolvedPythonDir) {
      if (!fs.existsSync(zipPath)) {
        await downloadFile(MANIFEST.pythonEmbedUrl, zipPath);
      }
      rmDirSafe(pythonDir);
      fs.mkdirSync(pythonDir, { recursive: true });
      extractZip(zipPath, pythonDir);
      resolvedPythonDir = findPythonEmbedRoot() || pythonDir;
    }
    resolvedPythonDir = normalizePythonEmbedLayout();
    if (!fs.existsSync(getPip)) {
      await downloadFile(MANIFEST.getPipUrl, getPip);
    }
    const pythonExe = path.join(resolvedPythonDir, 'python.exe');
    const okapiDir = path.join(PROJECT_ROOT, 'scripts', 'okapi-sidecar');
    const depsOk =
      fs.existsSync(path.join(resolvedPythonDir, 'Lib', 'site-packages', 'uvicorn')) &&
      spawnSync(
        `"${pythonExe}"`,
        ['-c', 'import pptx; from pptx_handler import extract_pptx'],
        { shell: true, stdio: 'ignore', windowsHide: true, cwd: okapiDir }
      ).status === 0;
    if (!depsOk) {
      log('Installing Python sidecar dependencies (DOCX/PPTX/HTML/TXT; first time may take a few minutes)…');
      setupPythonEmbed(resolvedPythonDir);
    }
    return resolvedPythonDir;
  })();
}

function rebuildNativeForNode(nodeDir, projectRoot) {
  const nodePath = `${nodeDir};${process.env.PATH || ''}`;
  const npmCmd = path.join(nodeDir, 'npm.cmd');
  stashBetterSqlite3Build(projectRoot);
  run(`"${npmCmd}" rebuild better-sqlite3`, {
    cwd: projectRoot,
    env: { ...process.env, PATH: nodePath },
  });
}

function buildFrontend() {
  run('npm.cmd run build', {
    env: {
      ...process.env,
      VITE_API_BASE_URL: 'http://127.0.0.1:58741',
      VITE_PACKAGE_PROFILE: 'portable',
    },
  });
}

function assembleStaging(nodeDir, pythonDir) {
  rmDirSafe(STAGING);
  fs.mkdirSync(STAGING, { recursive: true });

  const runtimeNode = path.join(STAGING, 'runtime', 'node');
  const runtimePython = path.join(STAGING, 'runtime', 'python');
  copyDirFiltered(nodeDir, runtimeNode);
  copyDirFiltered(pythonDir, runtimePython);

  fs.mkdirSync(path.join(STAGING, 'dist'), { recursive: true });
  copyDirFiltered(path.join(PROJECT_ROOT, 'dist'), path.join(STAGING, 'dist'));

  copyDirFiltered(path.join(PROJECT_ROOT, 'server'), path.join(STAGING, 'server'));

  copyDirFiltered(path.join(PROJECT_ROOT, 'scripts', 'okapi-sidecar'), path.join(STAGING, 'scripts', 'okapi-sidecar'), {
    excludeDirNames: ['.venv', '__pycache__'],
  });
  copyDirFiltered(
    path.join(PROJECT_ROOT, 'scripts', 'translators-server'),
    path.join(STAGING, 'scripts', 'translators-server'),
    { excludeDirNames: ['.venv', '__pycache__'] }
  );
  fs.mkdirSync(path.join(STAGING, 'scripts', 'packaging'), { recursive: true });
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'scripts', 'packaging', 'smartcat-launcher.mjs'),
    path.join(STAGING, 'scripts', 'packaging', 'smartcat-launcher.mjs')
  );

  log('Copying node_modules (may take a while)…');
  copyDirFiltered(path.join(PROJECT_ROOT, 'node_modules'), path.join(STAGING, 'node_modules'), {
    excludeDirNames: ['.cache'],
  });

  fs.copyFileSync(path.join(PROJECT_ROOT, 'package.json'), path.join(STAGING, 'package.json'));
  fs.copyFileSync(path.join(PROJECT_ROOT, 'Smart CAT Studio.bat'), path.join(STAGING, 'Smart CAT Studio.bat'));
  fs.copyFileSync(path.join(PROJECT_ROOT, 'Start-SmartCAT.bat'), path.join(STAGING, 'Start-SmartCAT.bat'));

  fs.writeFileSync(
    path.join(STAGING, 'README-PORTABLE.txt'),
    `Smart-CAT Studio V1.8.1 Portable
================================

1. Extract this ZIP to a normal folder (not a cloud-sync folder).
2. Open the extracted folder. You should see runtime, dist, Start-SmartCAT.bat here.
3. Double-click Start-SmartCAT.bat to launch.
4. Close the console window to stop all services.

If you see nested folders after extract, go into the inner folder that contains Start-SmartCAT.bat.

See docs\\便携版使用说明.txt for details.
`,
    'utf8'
  );

  const docsSrc = path.join(PROJECT_ROOT, 'docs', '便携版使用说明.txt');
  fs.mkdirSync(path.join(STAGING, 'docs'), { recursive: true });
  fs.copyFileSync(docsSrc, path.join(STAGING, 'docs', '便携版使用说明.txt'));

  fs.mkdirSync(path.join(STAGING, 'data'), { recursive: true });
  fs.writeFileSync(path.join(STAGING, 'data', '.gitkeep'), '', 'utf8');

  const gplNotice = path.join(STAGING, 'docs', 'MT-GPL-NOTICE.txt');
  fs.writeFileSync(
    gplNotice,
    `Smart-CAT Studio MT 参考侧车使用 translators 库 (GPL-3.0)。
源码: https://github.com/UlionTse/translators
分发本便携包时请保留此说明。
`,
    'utf8'
  );
}

function createZip() {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const zipPath = path.join(RELEASE_DIR, MANIFEST.zipFileName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const stagingGlob = path.join(STAGING, '*').replace(/'/g, "''");
  const zipEsc = zipPath.replace(/'/g, "''");
  run(
    `powershell -NoProfile -Command "Compress-Archive -Path '${stagingGlob}' -DestinationPath '${zipEsc}' -CompressionLevel Optimal"`
  );
  return zipPath;
}

async function main() {
  if (process.platform !== 'win32') {
    console.warn('[pack] Warning: portable assembly is intended for Windows x64.');
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  ensureNpmDependencies();

  log('Preparing embedded Node.js…');
  await ensureEmbeddedNode();
  const nodeDir = path.join(CACHE_DIR, `node-v${MANIFEST.nodeVersion}-win-x64`);

  log('Building frontend (portable profile)…');
  buildFrontend();

  log('Preparing embedded Python + sidecar deps…');
  const pythonDir = await ensureEmbeddedPython();

  log('Assembling staging folder…');
  assembleStaging(nodeDir, pythonDir);

  log('Rebuilding better-sqlite3 in staging for embedded Node…');
  rebuildNativeForNode(nodeDir, STAGING);

  log('Creating zip archive…');
  const zipPath = createZip();

  log(`Done: ${zipPath}`);
  log(`Staging folder: ${STAGING}`);
}

main().catch((err) => {
  console.error('[pack] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
