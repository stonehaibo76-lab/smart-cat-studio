# Smart-CAT Studio 部署指南

## 架构

- **前端**：Vercel（静态 SPA）
- **API**：Render（Docker 单容器：Node.js + Python Okapi 侧车）
- **数据库**：Supabase PostgreSQL

云端 API 容器内同时运行 **Okapi 侧车**（`127.0.0.1:8090`），支持 **纯译文（保真）** 原文格式导出（DOCX / PPTX / TXT / HTML）。导入时会自动保存原文件到 `xliff_blobs`；若项目是从本地迁移而来且缺少原文件备份，需在云端重新导入文档后再导出保真译文。

## 1. 准备 GitHub 仓库

```bash
git init
git add .
git commit -m "Initial commit: Smart-CAT Studio SaaS"
git branch -M main
git remote add origin https://github.com/<你的用户名>/smart-cat-studio.git
git push -u origin main
```

## 2. Supabase 数据库

1. 在 [supabase.com](https://supabase.com) 创建项目
2. Settings → Database → 复制 **Connection string (URI)**
3. SQL Editor 中表会在 API 首次启动时自动创建，也可手动执行 [`server/pgStore.mjs`](server/pgStore.mjs) 中的 `SCHEMA_SQL`

## 3. Render 部署 API

1. [render.com](https://render.com) → New Web Service → 连接 GitHub 仓库
2. 或使用 [`render.yaml`](render.yaml) 一键配置（**Docker 运行时**，见根目录 [`Dockerfile`](Dockerfile)）
3. 环境变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Supabase 连接串 |
| `JWT_SECRET` | 随机长字符串 |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | Vercel 域名（部署前端后填写） |
| `OKAPI_UPSTREAM_URL` | 可选，默认 `http://127.0.0.1:8090`（容器内 Okapi 地址） |

4. 容器启动：`scripts/render-start.sh` 先后台启动 Okapi（8090），确认健康后再 `exec node server/index.mjs`（Render 通过 Dockerfile `CMD` 配置）。
5. 验证：
   - `https://<api>.onrender.com/api/health` 返回 `ok: true, cloudMode: true`
   - `https://<api>.onrender.com/api/okapi/health` 返回 `ok: true, mergeSupported: true`

**资源提示**：Render 免费套餐内存有限，保真 merge 大文件（建议原文件 &lt; 50MB）可能较慢或 OOM；生产环境可考虑升级实例规格。

## 4. Vercel 部署前端

1. [vercel.com](https://vercel.com) → Import Git Repository
2. Framework: **Vite**
3. Build: `npm run build`，Output: `dist`
4. 环境变量：

| 变量 | 值 |
|------|-----|
| `VITE_API_BASE_URL` | `https://<api>.onrender.com` |
| `VITE_REQUIRE_AUTH` | `true` |

5. Deploy 后，将 Vercel 域名填回 Render 的 `FRONTEND_URL` 并重新部署 API

## 5. 日常更新（自动同步上线）

```bash
# 本地开发
npm run dev:with-db

# 确认无误后
git add .
git commit -m "feat: 描述改动"
git push origin main
```

推送后 Vercel 与 Render 会自动构建部署（约 2–5 分钟）。

## 6. 本地数据迁移到云端（可选）

```bash
DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-pg.mjs data/smartcat-local.db <你的org-id>
```

若通过注册创建了新账号，`org-id` 可在 Supabase `users` 表中查看。

## 7. 本地开发模式

**本地 SQLite（无需登录）：**

```bash
npm run dev:with-db
```

**本地连 Supabase 测试：**

```bash
# 终端 1
DATABASE_URL=postgresql://... JWT_SECRET=dev-secret FRONTEND_URL=http://localhost:5173 npm run server

# 终端 2
VITE_API_BASE_URL=http://127.0.0.1:58741 VITE_REQUIRE_AUTH=true npm run dev
```

## 环境变量参考

见 [`.env.example`](.env.example)
