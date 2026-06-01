// Rename better-sqlite3/build away so node-gyp clean does not unlink a locked .node file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'node_modules', 'better-sqlite3', 'build');

if (!fs.existsSync(buildDir)) {
  process.exit(0);
}

const backup = `${buildDir}.bak-${Date.now()}`;
try {
  fs.renameSync(buildDir, backup);
} catch (err) {
  const code = err && typeof err === 'object' ? err.code : '';
  if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
    console.error(
      [
        'Could not rename better-sqlite3/build (files are busy or locked).',
        '- Stop this project\'s backend (any `npm run server` / node using SQLite).',
        '- Pause cloud sync on this folder if it touches node_modules (e.g. Baidu Netdisk).',
        '- Optionally close other apps that scan node_modules, then retry.',
      ].join('\n')
    );
    process.exit(1);
  }
  throw err;
}
