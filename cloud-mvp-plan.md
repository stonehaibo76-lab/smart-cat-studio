# Smart-CAT Studio 上云 MVP 改造清单与步骤

## 目标（MVP）

先实现以下 5 件事：

- 多人可访问同一个系统（网页）
- 账号登录
- 项目数据集中存储（云数据库）
- 基本成员权限（谁能看/改）
- 稳定备份与恢复

---

## 阶段 0：准备（半天）

- 注册服务：
  - 代码仓库：GitHub
  - 前端托管：Vercel
  - API 托管：Render 或 Railway（二选一）
  - 数据库：Supabase PostgreSQL
  - 对象存储（可后补）：Cloudflare R2 / S3
- 确定域名（可选，MVP 阶段可先用平台域名）

---

## 阶段 1：后端先上云（1-2 天）

### 1.1 将本地 API 改为可云部署 API

当前后端已是 Express（`server/index.mjs`），可沿用接口风格：

- `/api/load-all`
- `/api/projects`
- `/api/term-bases`
- `/api/translation-memories`
- `/api/settings/:key`

### 1.2 数据库模型（MVP 简版）

先用过渡模型，降低改造成本：

- `documents(collection, id, org_id, payload_json, updated_at)`
- `settings_kv(org_id, key, payload_json, updated_at)`

> 与当前 SQLite 的通用 JSON 存储模型保持一致，迁移最快。

### 1.3 增加最小鉴权

- 用户登录后签发 JWT
- 前端请求带 `Authorization: Bearer <token>`
- 后端解析 token 获取 `org_id`
- 所有读写接口都按 `org_id` 做数据隔离

---

## 阶段 2：前端接云 API（1 天）

### 2.1 API 基地址环境变量化

将前端 API 基地址改为 `VITE_API_BASE_URL`：

- 本地：`http://127.0.0.1:58741`
- 线上：`https://<your-api-domain>`

### 2.2 增加登录态

- 增加登录页（邮箱/密码）
- 登录成功保存 token（MVP 可先 localStorage，后续建议 httpOnly Cookie）
- 统一 fetch 封装中自动附带 Authorization 头

### 2.3 页面层尽量不动

- 保留现有页面数据结构
- 仅替换数据来源（从本地服务改为云服务）

---

## 阶段 3：部署（半天）

### 3.1 部署 API（Render / Railway）

- 新建服务并连接 GitHub 仓库
- 配置环境变量：
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `NODE_ENV=production`
- 启动命令：`node server/index.mjs`（或改造后的入口）

### 3.2 部署前端（Vercel）

- 导入仓库
- 配置环境变量：
  - `VITE_API_BASE_URL=https://<your-api-domain>`
- 构建命令：`npm run build`

---

## 阶段 4：数据迁移（1 天）

### 4.1 从本地 SQLite 导出并迁移

- 导出现有 `.db` 文件
- 编写迁移脚本：
  - 读取 SQLite 的 `documents/settings_kv`
  - 批量写入 PostgreSQL 对应表，并补充 `org_id`

### 4.2 迁移验收

随机抽样 3 个项目对比：

- 文件数量
- 段落数量
- TM/TB 条目数量
- 项目设置项是否完整

---

## 阶段 5：多人最小权限（1 天）

先定义 3 个角色：

- `owner`：全部权限
- `editor`：可读写项目
- `viewer`：只读

MVP 权限规则：

- 项目接口：`owner/editor` 可写，`viewer` 只读
- 术语库/TM 接口：同上

---

## 阶段 6：上线前检查（半天）

- 并发测试：2 人同时编辑同项目不崩溃
- 权限测试：`viewer` 无法写入
- 备份恢复测试：可恢复到指定时间点
- 日志监控：API 错误日志可追踪

---

## 推荐技术组合（MVP）

- 前端：Vercel
- 后端：Render
- 数据库：Supabase PostgreSQL
- 鉴权：JWT（后续可升级 OAuth/SSO）
- 存储：Cloudflare R2（后补）

---

## Day 1 执行清单（建议）

1. 选定平台组合（Vercel + Render + Supabase）
2. 完成后端环境变量与数据库连接
3. 打通一个受保护接口（如 `/api/load-all`）
4. 前端接入登录与 token
5. 前端改用 `VITE_API_BASE_URL` 访问云 API
6. 本地联调通过后再部署
