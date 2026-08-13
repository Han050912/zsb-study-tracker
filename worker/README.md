# zsb-study-api（Cloudflare Worker + D1）

专升本学习系统后端：JWT 认证、25 张 D1 表数据 CRUD、全量同步、墨墨背单词 API 代理。

## 本地开发

```bash
cd worker
npm install

# 1. 初始化本地 D1（执行 schema.sql 建表）
npm run init:local

# 2. 启动本地开发服务器（默认 http://localhost:8787）
npm run dev
```

本地 JWT_SECRET 放在 `.dev.vars`（已 gitignore，勿提交）。

## 冒烟测试

先按上面步骤启动 `npm run dev`，再另开终端：

```bash
npm run smoke
```

覆盖：CORS 预检、注册/登录/JWT、各实体 CRUD、全量同步、未认证 401、跨用户数据隔离。

## 部署

```bash
# 1. 在 Cloudflare 控制台为 Worker 设置加密变量 JWT_SECRET
#    （Workers & Pages → zsb-study-api → Settings → Variables → Encrypt）
# 2. 创建社区图片 R2 bucket（社区增强 P0 新增，仅需一次）
npx wrangler r2 bucket create zsb-study-images
# 3. 初始化线上 D1 表结构
npx wrangler d1 execute zsb-study-db --remote --file=./schema.sql
# 4. 部署
npx wrangler deploy
```

已有线上库升级（社区增强 P0：图片/提问帖/举报/审核留痕），执行一次 schema.sql 头部注释中的
ALTER/CREATE 语句（`--remote`），或直接粘贴执行：

```bash
npx wrangler d1 execute zsb-study-db --remote --command "ALTER TABLE community_posts ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]'"
npx wrangler d1 execute zsb-study-db --remote --command "ALTER TABLE community_posts ADD COLUMN is_resolved INTEGER NOT NULL DEFAULT 0"
npx wrangler d1 execute zsb-study-db --remote --command "CREATE TABLE IF NOT EXISTS community_uploads ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL DEFAULT '', r2_key TEXT NOT NULL, url TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL, created_at INTEGER NOT NULL )"
npx wrangler d1 execute zsb-study-db --remote --command "CREATE INDEX IF NOT EXISTS idx_uploads_user ON community_uploads(user_id)"
npx wrangler d1 execute zsb-study-db --remote --command "CREATE TABLE IF NOT EXISTS community_reports ( id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL )"
npx wrangler d1 execute zsb-study-db --remote --command "CREATE INDEX IF NOT EXISTS idx_reports_status ON community_reports(status, created_at)"
npx wrangler d1 execute zsb-study-db --remote --command "CREATE TABLE IF NOT EXISTS community_moderation_log ( id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, report_id TEXT, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL )"
npx wrangler d1 execute zsb-study-db --remote --command "CREATE INDEX IF NOT EXISTS idx_modlog_created ON community_moderation_log(created_at)"
```

## 部署风险提示

- **bcryptjs CPU 耗时**：cost=10 的纯 JS 哈希约 50-100ms CPU，可能超出 Workers 免费档默认 CPU 上限（付费档无影响）。如遇 CPU 超限错误，需升级套餐或调整上限。
- **登录/注册无速率限制**：生产环境建议在 Cloudflare 控制台配置 Rate Limiting 规则防止撞库。

## 目录说明

- `src/index.ts` — 入口：CORS（动态 Origin 白名单 + OPTIONS 预检）+ 错误兜底
- `src/router.ts` — 路径段匹配（支持 `:id` 参数）+ 方法分发
- `src/auth.ts` — bcryptjs 哈希/比对 + jose 签发/验证 HS256 JWT（7 天）
- `src/db.ts` — D1 参数化查询封装 + 通用 CRUD handler 工厂
- `src/middleware/auth.ts` — requireAuth：解析 Bearer Token → user_id
- `src/api/` — 每个业务实体一个 handler 文件
- `src/proxy/maimemo.ts` — 墨墨 API 代理（Token 从 user_settings 读取）
- `test/smoke.mjs` — 冒烟测试脚本（Node 原生，无测试框架）
