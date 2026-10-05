# 贡献指南 · Contributing

感谢你对 **专升本学习助手（zsb-study-tracker）** 的关注！本项目欢迎任何形式的贡献：Bug 报告、功能建议、文档改进、代码提交。

## 目录

- [行为准则](#行为准则)
- [快速开始](#快速开始)
- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [分支策略](#分支策略)
- [代码规范](#代码规范)
- [本地检查](#本地检查)
- [提交 Commit](#提交-commit)
- [提交 Pull Request](#提交-pull-request)
- [反馈与建议](#反馈与建议)

---

## 行为准则

参与讨论与协作时，请保持尊重和包容。

---

## 快速开始

> 环境要求：**Node.js 22.18+（22.x）**，与 GitHub Actions 的 Node.js 22 环境对齐。默认测试直接导入 TypeScript，需要支持默认类型剥离的 Node.js 版本；当前 ESLint、concurrently 和 Wrangler 也已不支持 Node.js 18。

```bash
git clone https://github.com/Han050912/zsb-study-tracker.git
cd zsb-study-tracker
npm ci
npm ci --prefix worker # 根目录测试也会使用 Worker 依赖
test -f .env || cp .env.example .env # 保留已有本地配置
cp .env.example .env.development # Windows PowerShell 可使用 Copy-Item
npm run dev          # 启动 Web 开发服务器（http://localhost:5173）
```

`.env` 和 `.env.development` 是 Git 忽略的本地配置；PowerShell 首次准备默认配置使用 `if (-not (Test-Path .env)) { Copy-Item .env.example .env }`。`.env.development` 的 `VITE_API_BASE` 指定开发 API 地址。使用本地 Worker 时设为 `http://localhost:8787`，并按下方步骤初始化后端。前端配置在 Vite 启动或构建时读取，修改后需重启开发服务器；该开发文件不影响普通生产和 desktop 模式构建。

---

## 开发环境搭建

### Web 端

```bash
npm ci               # 按锁文件安装依赖
npm run dev          # Vite HMR 开发服务器
npm run build        # 生产构建（输出到 dist/）
npm run preview      # 预览生产构建
```

### 桌面端（Electron）

```bash
npm run electron:dev # 同时启动 Vite 和 Electron
npm run build:desktop # 构建桌面渲染层，输出到 dist/
npm run dist:win     # 打包 Windows 安装包（NSIS，输出到 release/）
npm run dist:mac     # 打包 macOS DMG（需在 macOS 上执行）
```

桌面生产构建通过自定义 `app://` 安全协议加载本地静态资源；开发环境加载 Vite。Vite 页面支持热更新，修改 Electron 主进程或 preload 后需重启 Electron。`electron:dev` 使用普通 Web 开发构建，不能替代桌面生产认证与打包验收。

可登录的桌面生产构建需要在 `.env.desktop.local` 或构建环境中设置 `DESKTOP_TOKEN`，且与 Worker Secret 一致；`VITE_API_BASE` 同样需指向对应后端。桌面构建会把两者写入 `dist/api-base.json`，供主进程读取，因此共享桌面令牌属于分发给客户端的凭据，不能视为仅服务端持有的秘密。

自动更新仅在打包后的 Windows 端启用：应用会检查更新，由用户下载并确认安装。macOS 可本地构建，但仓库没有 macOS 发布工作流或自动更新通道。详细配置见 [Worker 开发与部署](./worker/README.md)。

### Cloudflare Worker 后端

Worker 代码位于 `worker/` 目录，负责账号认证、学习记录同步、笔记与 PDF、社区和协作接口，以及墨墨、壁纸等代理。数据库使用 D1，图片使用 R2。

```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars # Windows PowerShell 可使用 Copy-Item
npm run init:local     # 用 schema.sql 初始化新的本地 D1
npm run dev            # 本地调试，默认 http://localhost:8787
```

本地 `.dev.vars` 需保留 `ALLOW_LOCAL_ORIGINS=1`，并配置本地 JWT 与 Turnstile 测试密钥；不要提交该文件。`init:local` 是新库初始化入口，不会替已有库补齐所有变更。已有库升级、生产资源创建和 Secrets 配置见 [worker/README.md](./worker/README.md)。

---

## 项目结构

```
zsb-study-tracker/
├── src/                  # Vue 3 前端源码
│   ├── components/       # 通用组件
│   ├── pages/            # 路由页面
│   ├── api/              # 前端 API 调用
│   ├── services/         # 会话、同步队列、笔记缓存等
│   ├── features/         # 社区和协作路由
│   ├── shared/           # 共享组件、组合式函数和样式
│   ├── stores/           # Pinia 状态管理
│   ├── utils/            # 工具函数
│   └── ...
├── electron/             # Electron 桌面端入口与配置
├── worker/               # Cloudflare Worker 后端
│   ├── src/
│       ├── index.ts      # Worker 入口
│       ├── router.ts     # 路由注册
│       ├── api/          # 业务接口
│       ├── proxy/        # 第三方 API 代理
│       └── middleware/   # 认证、缓存与限流
│   ├── schema.sql        # 新库基线
│   ├── migrations/       # 已有数据库迁移
│   └── test/             # 测试脚本
├── public/               # 静态资源
├── index.html            # HTML 入口
├── vite.config.ts        # Vite 配置
├── tailwind.config.js    # Tailwind CSS 配置
├── .github/workflows/    # CI、Web/Worker 部署与桌面发布
└── package.json          # 项目配置与脚本
```

---

## 分支策略

- **`master`**：稳定发布分支，每次 Release 从 development 合并
- **`development`**：日常开发分支，所有 PR 合入此分支

请从 `development` 分支创建功能/修复分支：

```bash
git checkout development
git pull origin development
git checkout -b feat/your-feature   # 新功能
git checkout -b fix/your-bug        # Bug 修复
```

---

## 代码规范

### 通用

- 使用 **TypeScript**，充分利用类型系统
- 修改同步协议、备份格式或数据库字段时，检查已有数据、客户端与迁移需求；说明兼容边界
- 保持改动最小化、外科手术式精准编辑
- 优先复用现有依赖，不重复造轮子

### 前端

- 使用 Vue 3 **`<script setup>`** 语法
- 优先复用 **Tailwind CSS** 与 `src/style.css` 中现有设计令牌和共享类，保持移动端响应式
- 新页面/组件放在对应目录，保持命名风格一致
- 图标使用 SVG 组件（Lucide），**不要用 emoji 作图标**

### Worker

- 只能使用 **Web 标准 API**（`fetch`、`crypto.subtle` 等），不要引入 Node 专有模块
- 第三方 API 代理放在 `worker/src/proxy/` 下，业务接口放在 `worker/src/api/` 下；各模块通过 `router.ts` 的 `on()` 注册，由 `index.ts` 调用注册函数
- 数据库变更同时核对 `worker/schema.sql` 和 `worker/migrations/`；新库与升级后的已有库应使用一致的结构

---

## 本地检查

在根目录执行以下检查；`npm test` 覆盖 Electron 与 Worker 的 `*.test.cjs` / `*.test.mjs` 文件，因此需先安装两处依赖：

```bash
npm ci
npm ci --prefix worker
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run typecheck --prefix worker
```

这与 [.github/workflows/ci.yml](./.github/workflows/ci.yml) 的检查项目对应。Web、Worker 部署和 Windows 发布工作流都会先运行该 CI。只修改 Markdown 时，至少对改动文件运行 Prettier 检查，并核对命令、相对链接和代码示例；不要为格式化文档批量改写无关源码。

`.prettierignore` 默认忽略 `*.md`，因此 `npm run format:check` 不会检查 Markdown。请使用临时空 ignore 文件定向检查文档；下面是 PowerShell 示例，将文件列表替换为本次实际改动的 Markdown 文件：

```powershell
$markdownIgnore = New-TemporaryFile
try {
  npx prettier --ignore-path $markdownIgnore.FullName --check README.md CONTRIBUTING.md worker/README.md
} finally {
  Remove-Item -LiteralPath $markdownIgnore.FullName
}
```

`worker/test/smoke.mjs`、`record-sync.mjs`、`note-bodies.mjs` 和 `error-images.mjs` 是独立的本地集成脚本，未包含在默认 `npm test` 中；它们会创建测试数据，应仅针对本地 Worker 和本地 D1/R2 运行。准备步骤见 [Worker 测试说明](./worker/README.md)。

---

## 提交 Commit

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范：

| 类型        | 用途                       |
| ----------- | -------------------------- |
| `feat:`     | 新功能                     |
| `fix:`      | Bug 修复                   |
| `docs:`     | 文档更新                   |
| `style:`    | 代码格式（不影响逻辑）     |
| `refactor:` | 重构（既非新功能也非修复） |
| `perf:`     | 性能优化                   |
| `test:`     | 测试相关                   |
| `chore:`    | 构建/工具链杂项            |

示例：

```
feat: 新增单词背诵统计图表
fix: 修复番茄钟暂停后时间归零的问题
docs: 更新桌面端打包指南
```

---

## 提交 Pull Request

1. **Fork** 本仓库到你的 GitHub 账号
2. 基于 `development` 创建功能/修复分支并编码
3. 完成与改动相关的[本地检查](#本地检查)，必要时验证 Web 页面、桌面构建或本地 Worker 集成场景
4. 提交 PR，目标分支为 **`development`**
5. PR 标题遵循 Conventional Commits 格式
6. 在 PR 描述中说明改动内容、动机和验证结果

> 维护者将在 3 个工作日内回复。如需修改，请在同一分支上追加 commit 即可，PR 会自动更新。

---

## 反馈与建议

- **Bug 反馈**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)，附上复现步骤和运行环境
- **功能建议**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)，打上 `enhancement` 标签
- **安全问题**：请通过 [GitHub 私有漏洞报告](https://github.com/Han050912/zsb-study-tracker/security/advisories/new) 提交，勿在公开 Issue 披露细节；入口未启用时可 [私信维护者](https://t.me/hanhaoyi888)。

---

再次感谢你的贡献！
