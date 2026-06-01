/**
 * 若未安装 Vite（常见于复制项目后未执行 npm install），自动 npm install。
 * 由 package.json 的 predev 钩子调用；启动 bat 内亦有同等检测。
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitePkg = path.join(root, 'node_modules', 'vite', 'package.json');

if (fs.existsSync(vitePkg)) {
  process.exit(0);
}

console.log('[SmartCAT] 未检测到 Vite，正在执行 npm install ...');
const result = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status === null ? 1 : result.status);
