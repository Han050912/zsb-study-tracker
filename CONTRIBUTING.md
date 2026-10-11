# 贡献指南 · Contributing

感谢你对 **专升本学习助手（zsb-study-tracker）** 的关注！本项目欢迎任何形式的贡献：Bug 报告、功能建议、文档改进、代码提交。

## 目录

- [行为准则](#行为准则)
- [快速开始](#快速开始)
- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [分支策略](#分支策略)
- [代码规范](#代码规范)
- [数据与安全约束](#数据与安全约束)
- [本地检查](#本地检查)
- [提交 Commit](#提交-commit)
- [提交 Pull Request](#提交-pull-request)
- [发布流程（维护者）](#发布流程维护者)
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
test -f .env || cp .env.example .env # 保留仓库的默认配置
test -f .env.development.local || cp .env.example .env.development.local
npm run dev          # 启动 Web 开发服务器（http://localhost:5173）
```

仓库已跟踪根目录 `.env`，用于非敏感 Web 默认配置；即使 `.gitignore` 中列出 `.env`，它的改动仍会进入 Git。机器专用地址和真实凭据应通过已忽略的 `.env.*.local` 文件覆盖。PowerShell 首次准备开发配置可用：

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if (-not (Test-Path .env.development.local)) { Copy-Item .env.example .env.development.local }
```

`.env.development.local` 的 `VITE_API_BASE` 指定开发 API 地址。使用本地 Worker 时设为 `http://localhost:8787`，并按下方步骤初始化后端。前端配置在 Vite 启动或构建时读取，修改后需重启开发服务器；该开发文件不影响普通生产和 desktop 模式构建。不要在任何 `VITE_*` 变量中存放需对客户端保密的值。

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
test -f .dev.vars || cp .dev.vars.example .dev.vars
npm run init:local     # 用 schema.sql 初始化新的本地 D1
node scripts/check-migration-baseline.mjs
npx wrangler d1 execute zsb-study-db --local --file=./schema-baseline.sql
npx wrangler d1 migrations list zsb-study-db --local
npm run dev            # 本地调试，默认 http://localhost:8787
```

PowerShell 首次创建配置可用 `if (-not (Test-Path .dev.vars)) { Copy-Item .dev.vars.example .dev.vars }`。本地 `.dev.vars` 需保留 `ALLOW_LOCAL_ORIGINS=1`，并配置本地 JWT 与 Turnstile 测试密钥；不要提交该文件。

以上数据库命令仅适用于全新的本地库：当前 `schema.sql` 已包含 `0001`–`0013` 的结构，全部执行成功后才登记 `schema-baseline.sql`，迁移列表应无待执行项。不要对旧库整批登记新库基线，也不要在快照初始化后直接重跑全部增列迁移。`init:local` 不会替已有库补齐变更；已有库升级、隔离测试目录、生产资源和 Secrets 配置见 [worker/README.md](./worker/README.md)。

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
│   │   ├── index.ts      # Worker 入口
│   │   ├── router.ts     # 路由注册
│   │   ├── api/          # 业务接口
│   │   ├── proxy/        # 第三方 API 代理
│   │   └── middleware/   # 认证、缓存与限流
│   ├── schema.sql        # 新库基线
│   ├── schema-baseline.sql # 新库的迁移登记
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

- **`master`**：稳定发布分支，通过 `development` → `master` 的发布 PR 更新
- **`development`**：日常开发分支，功能、修复和文档 PR 均以此为目标

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
- 保持改动范围明确，避免混入无关格式化或重构
- 优先复用现有依赖，不重复造轮子

### 前端

- 使用 Vue 3 **`<script setup>`** 语法
- 优先复用 **Tailwind CSS** 与 `src/style.css` 中现有设计令牌和共享类，保持移动端响应式
- 新页面/组件放在对应目录，保持命名风格一致
- 图标使用 SVG 组件（Lucide），**不要用 emoji 作图标**

### Worker

- 只能使用 **Web 标准 API**（`fetch`、`crypto.subtle` 等），不要引入 Node 专有模块
- 第三方 API 代理放在 `worker/src/proxy/` 下，业务接口放在 `worker/src/api/` 下；各模块通过 `router.ts` 的 `on()` 注册，由 `index.ts` 调用注册函数
- 数据库变更同时更新 `worker/schema.sql`、`worker/migrations/` 和 `worker/schema-baseline.sql`；新库与升级后的已有库应使用一致的结构，并在同一提交中包含迁移回归测试

---

## 数据与安全约束

### 学习记录、同步与备份

- 新增数据字段时，同步核对前端类型与 store、Worker 校验与 CRUD、同步域映射、导入导出校验和 SQL 迁移。可选字段需兼容旧客户端与旧备份；科目、章节或任务删除后，历史记录仍需可读。
- 待办可关联科目和章节；专注记录保留任务、科目与章节关联。专注归入分科统计时，复用 `src/utils/studyTime.ts` 的统计口径，不能再生成一份重复计时的手动学习记录。刷新恢复、提前结束和确认完成任务应分别验证。
- 错题复习区分 `again`、`hard`、`good` 反馈。历史复习次数不能转换为连续答对次数；旧数据从 0 开始累计。复习日期沿用项目的 UTC+8 业务日期，作答操作须校验当前账号和题目身份。
- 同步应保留 `updatedAt` 冲突处理、服务端游标和删除标记语义。账号切换后，旧请求不能回写新会话；重试不能重复产生记录。替换恢复时，先同步新数据及其依赖，再处理旧数据删除；失败项保留为可重试状态。
- 笔记正文要区分内存修改、本地 IndexedDB 持久化与云端同步。写入失败时不能提示已保存，冲突副本与尚未同步的正文不能被旧响应覆盖；导出应读取最新可用正文。
- 完整备份使用 `zsb-study-backup` version 2，包含学习数据、笔记正文及 PDF/错题图片附件。保留 SHA-256、类型、大小和引用校验，以及附件总量 128 MiB、文件总量 192 MiB 的限制。恢复前先生成当前数据快照；附件失败、限流、账号切换或并发修改时，不能继续破坏性替换。

数据库变更需同时验证空库初始化与带历史数据的升级。`0012_focus_task_links.sql` 和 `0013_error_review_feedback.sql` 须先于依赖它们的新 Worker 应用；更早的 `0011` 与 Worker 有切换约束，旧库请按 [迁移说明](./worker/README.md) 核查，不能只凭迁移文件存在就视为可直接升级。

### Electron 与凭据

- 保留 `contextIsolation: true`、`nodeIntegration: false`，通过 preload 暴露有限能力；新增 IPC 时校验参数和调用上下文，订阅事件要有清理函数。
- 复用 `electron/security.cjs` 的协议、导航、资源路径和通知图标策略。生产页面限定于应用来源，开发服务器限定于本机；外部链接交给系统浏览器。不要让外部内容或 Blob 子窗口获得主窗口的 preload 能力。
- 桌面共享令牌不能替代用户认证和服务端授权。不要在日志、截图或测试 fixture 中加入真实 Token、JWT 密钥、Cloudflare 凭据或用户备份；本地配置沿用已忽略的环境文件。
- 修改下载、取消或安装更新流程时，验证事件订阅清理、用户更新偏好和版本说明渲染；开发模式无法替代打包后的 Windows 更新验收。

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

回归测试按行为选择；下列测试均已包含在根目录的 `npm test` 中：

| 改动范围         | 重点测试与覆盖                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务、专注与统计 | `focus-task-links.test.mjs`、`pomodoro-completion.test.mjs`、`todo-interactions.test.mjs`：关联持久化、单次计时、提前结束、删除关联后的兼容和任务交互 |
| 引导、计划与错题 | `learning-plan.test.mjs`、`study-flow-interactions.test.mjs`：跳过后继续、计划预算与重复添加、反馈进度、账号/题目隔离和路由参数变化                   |
| 完整备份         | `complete-backup.test.mjs`：正文与附件恢复、恢复前快照、哈希/引用损坏、旧备份、失败清理、账号切换和限流重试                                           |
| 恢复后的同步     | `backup-sync-batches.test.mjs`：跨批次恢复先写入后删除、依赖写入失败、恢复抢占旧同步和并发删除保护                                                    |
| 笔记可靠性       | `note-storage-reliability.test.mjs`：IndexedDB 失败、延迟回调、冲突副本、未保存离开保护和过期响应                                                     |
| 数据库与桌面     | `migration-baseline.test.mjs` 校验迁移基线；`electron/*.test.cjs` 覆盖隔离策略、preload 和更新事件等桌面行为                                          |

上表未带目录的文件位于 `worker/test/`。开发中可定向执行，例如 `node --test worker/test/complete-backup.test.mjs worker/test/backup-sync-batches.test.mjs`；提交前仍需完成受影响范围的检查。交互测试应操作真实组件行为，清理挂载实例、定时器和全局状态，避免失败后进程挂起。修改 Vue 模板后运行生产构建，以发现类型检查未覆盖的模板编译问题；界面变更还应验收窄屏、键盘操作及浅色/深色主题。

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
6. 在 PR 描述中说明用户可见变化、验证结果，以及迁移、兼容或部署顺序要求

如需修改，在同一分支上追加 commit 即可，PR 会自动更新。按可独立审查的行为拆分提交；数据库字段、迁移、同步映射和对应测试应一起提交，避免中间版本缺少必要结构。

---

## 发布流程（维护者）

### Web 与 Worker

1. 日常 PR 先合入 `development`，完成 CI 与相关页面、本地 Worker 或桌面验收。若计划发布桌面新版，先在开发分支同步更新根目录 `package.json` 与 `package-lock.json` 的版本。
2. 创建 `development` → `master` 的发布 PR，说明累计改动、迁移前置条件和验证结果。数据库变更先在隔离副本核查，并准备备份；确认发布 PR 的 CI 通过后再合并。
3. 合并到 `master` 后，[Pages 工作流](./.github/workflows/deploy-pages.yml) 自动检查、构建并发布 Web；有 `worker/**` 变更时，[Worker 工作流](./.github/workflows/deploy-worker.yml) 自动检查，再依次执行 `wrangler d1 migrations apply zsb-study-db --remote` 和 `wrangler deploy`。未涉及 `worker/**` 的文档或前端变更不会触发 Worker 路径规则，修改 `worker/README.md` 也会触发；可按需手动运行工作流。
4. 检查本次提交对应的部署结果，再验证线上登录、学习数据同步和受影响功能。Pages 与 Worker 分别运行，没有彼此等待关系，跨端变更必须考虑部署期间的兼容性；PR 合并成功不代表部署已成功。

所有部署工作流先调用 [CI](./.github/workflows/ci.yml)。Worker 发布依赖仓库 Secrets `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`；认证、R2、Turnstile 等运行时配置仍按 [Worker 部署指南](./worker/README.md) 管理。自动迁移不能代替首次资源初始化或旧库迁移核查；不要通过重新初始化数据库解决部署失败。

### Windows 桌面版

1. 在已经验证的 `master` 提交上创建并推送 `vX.Y.Z` 标签，替换为根目录 `package.json` 中的实际版本。标签不是日常 PR 的替代品；工作流校验标签版本，但不会自动核查它是否来自 `master`。
2. [Release Desktop](./.github/workflows/release-desktop.yml) 在 `v*` 标签推送或手动触发时运行，先通过共用 CI，再在原生 **`windows-latest`** runner 上构建 NSIS 安装包。该 runner 的脚本使用 Bash，但构建环境仍是 Windows。
3. 仓库 Secret `DESKTOP_TOKEN` 必须已配置并与 Worker 一致。工作流先检查该值，再执行 `npm run build:desktop`，确认 `dist/api-base.json` 存在且非空，最后通过 `electron-builder --win --publish always` 上传产物；上传权限使用工作流的 `GITHUB_TOKEN`。
4. 检查 GitHub Release 草稿中的 Windows 安装包与 `latest.yml` 等更新产物，验收安装、登录和升级后再手动发布 Release。默认草稿对自动更新不可见，仅上传成功不会使客户端收到新版。

本地 Windows 打包使用 `npm run dist:win`，产物在 `release/`。macOS 的 `npm run dist:mac` 需在 macOS 执行，当前无 macOS CI 发布、签名或自动更新通道。不要把 Web 构建成功等同于桌面认证、安装和更新验收通过。

---

## 反馈与建议

- **Bug 反馈**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)，附上复现步骤和运行环境
- **功能建议**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)，打上 `enhancement` 标签
- **安全问题**：请通过 [GitHub 私有漏洞报告](https://github.com/Han050912/zsb-study-tracker/security/advisories/new) 提交，勿在公开 Issue 披露细节；入口未启用时可 [私信维护者](https://t.me/hanhaoyi888)。

---

再次感谢你的贡献！
