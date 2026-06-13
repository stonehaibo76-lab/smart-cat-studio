/**
 * Legacy entry: delegate to Node API (Okapi sidecar is spawned from server/index.mjs in cloud mode).
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const nodeProc = spawn('node', ['server/index.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

nodeProc.on('exit', (code) => process.exit(code ?? 0));
