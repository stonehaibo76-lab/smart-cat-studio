import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { smartCatDevServerPlugin } from './scripts/smartcat-dev-server-plugin';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
         port: 0, // ✅ 保留！随机端口，解决多项目端口冲突（核心需求）
         // 默认 localhost，避免他人机器未配置 hosts 时出现 ENOTFOUND dev-app.local
         // 需要自定义域名时在 .env 中设置 DEV_SERVER_HOST=dev-app.local，并在本机 hosts 指向 127.0.0.1
         host: env.DEV_SERVER_HOST || 'localhost',
         strictPort: false, // ✅ 自动跳过占用端口，不用手动干预
         open: false, // 避免重复弹出浏览器窗口
      },
      plugins: [react(), smartCatDevServerPlugin(projectRoot)],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': projectRoot,
        }
      }
    };
});
