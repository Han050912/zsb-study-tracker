# zsb-study-api（Cloudflare Worker + D1 + R2）

专升本学习系统后端，提供账号认证、学习数据 CRUD、记录级增量同步、社区、学习搭子与小组、学习奖励、附件存储，以及墨墨和桌面版本查询代理。

前端使用说明见 [项目 README](../README.md)。本文件说明 Worker 的本地运行、数据库升级与部署。

## 架构与运行配置

- `src/index.ts` 统一处理 CORS、预检、缓存与错误，并注册业务路由。
- D1 绑定 `DB`，数据库名为 `zsb-study-db`；R2 绑定 `IMAGES`，bucket 为 `zsb-study-images`，用于社区图片、头像及错题图片。
- `/api/data/push` 提交各同步域的记录变更；`/api/data/pull` 支持首次全量快照与按域游标拉取增量。删除墓碑防止旧设备恢复已删记录，积分由服务端业务记录核算。
- 定时任务每小时清理孤图、重试附件删除、清理过期认证记录和回收僵尸会话；周报在每周一 08:00（UTC+8）推送。对应 cron 为 `0 * * * *` 和 `0 0 * * 1`。
- 当前 `wrangler.toml` 部署路由为 `cn.zsbservice.de5.net/*`，关闭 `workers.dev` 与预览 URL，并启用 Smart Placement 和日志观测。迁移登记表使用 Wrangler 默认的 `d1_migrations`。

## 本地开发

项目统一使用 Node.js 22.18 或更高版本，CI 使用 Node.js 22。以下 Windows 环境配置示例使用 PowerShell；`npm`、`npx` 命令也可在其他终端运行。

首次准备依赖与配置（已有 `.dev.vars` 时保留该文件，按模板补充缺项）：

```powershell
cd worker
npm ci
if (-not (Test-Path .dev.vars)) { Copy-Item .dev.vars.example .dev.vars }
```

编辑 `.dev.vars`，本地开发至少需要：

```dotenv
JWT_SECRET=dev-local-secret
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
ALLOW_LOCAL_ORIGINS=1
```

Turnstile 测试密钥与前端开发构建的测试 sitekey 配套。`ALLOW_LOCAL_ORIGINS=1` 用于放行本地前端：当前生产路由会使 `wrangler dev` 的请求主机判定不能直接识别本机来源。该开关只放在本地 `.dev.vars`，不要配置到生产环境。

按下文“数据库初始化与升级”处理新库或已有库，再启动：

```powershell
npm run typecheck
npm run dev
```

默认地址为 `http://localhost:8787`。前端在仓库根目录启动；若需连接此本地 Worker，可在根目录 `.env.development` 设置 `VITE_API_BASE=http://localhost:8787`，然后重启前端开发服务；本机额外覆盖可放在 `.env.development.local`。

### 环境变量

实际 `.dev.vars` 已被 Git 忽略，模板见 [.dev.vars.example](.dev.vars.example)。生产密钥通过 `npx wrangler secret put <变量名>` 配置，绑定和公开配置由 [wrangler.toml](wrangler.toml) 管理。

| 变量                  | 用途与配置要求                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`          | JWT 签名密钥，必须配置；未设置独立加密密钥时也用于派生敏感字段加密密钥。                            |
| `TURNSTILE_SECRET`    | Web 注册、登录及改密的人机验证密钥；本地使用模板中的测试密钥，生产使用站点对应的密钥。              |
| `DESKTOP_TOKEN`       | 桌面请求通过 `X-Desktop-Token` 跳过 Turnstile，必须与桌面构建注入值一致；本地冒烟测试也使用此机制。 |
| `ALLOW_LOCAL_ORIGINS` | 本地设为 `1`，生产不配置。                                                                          |
| `ENCRYPT_SECRET`      | 可选的独立敏感字段加密密钥，用于墨墨 Token 等凭证；未配置时回退 `JWT_SECRET`。                      |
| `CF_API_TOKEN`        | 可选的 Workers AI 内容复审令牌。                                                                    |
| `CF_ACCOUNT_ID`       | Workers AI 账户 ID，当前已由 `[vars]` 注入；本地可覆盖。顶层 `account_id` 本身不会注入运行时环境。  |
| `GITHUB_TOKEN`        | 版本查询和反馈转 GitHub issue 的服务端令牌；缺少时版本查询返回失败，反馈仍可落 D1。                 |
| `ALERT_WEBHOOK`       | 可选的定时任务失败告警地址，发送 `{ "text": "..." }`；接收端需支持该消息格式。未配置时只记录日志。  |

内容审核先执行本地词库过滤，再按配置进行 AI 语义复审。AI 凭证缺失、调用失败或超时会跳过 AI 层，本地词库仍生效。

加密字段使用 AES-256-GCM。配置 `ENCRYPT_SECRET` 后再移除、替换它，或回滚到不支持该密钥的代码，可能使已有密文无法解密，用户需重填墨墨 Token。未配置独立密钥时，轮换 `JWT_SECRET` 也会影响密文；引入独立密钥后的历史密文仍可能依赖原 `JWT_SECRET`。

## 数据库初始化与升级

以下命令在 `worker/` 执行。`schema.sql` 是完整结构快照，`migrations/` 是已有数据库的增量变更，不能把两者无条件连续执行。`CREATE TABLE IF NOT EXISTS` 不会为已有表补列；当前迁移目录也不包含所有历史版本的完整升级路径。

### 新数据库

仅用于完全新建、没有用户数据的数据库。先执行当前结构快照：

```powershell
npm run init:local
```

当前快照包含 `0001`–`0011` 的结构与索引；数据修复迁移在空库中没有历史数据需要处理。确认快照全部执行成功后，用随快照维护的 `schema-baseline.sql` 登记这十一项为新库迁移基线：

```powershell
node scripts/check-migration-baseline.mjs
npx wrangler d1 execute zsb-study-db --local --file=./schema-baseline.sql
npx wrangler d1 migrations list zsb-study-db --local
```

在本版本中，最后一条应显示无待执行迁移。登记操作只写迁移记录，不执行 SQL 变更；不要对旧库整批登记，也不要把今后新增文件直接加入这份基线清单。新建线上库时，使用同一流程：把初始化命令换为 `npx wrangler d1 execute zsb-study-db --remote --file=./schema.sql`，并将后续命令的 `--local` 换成 `--remote`。

### 已有数据库

先核查现有结构、备份和迁移登记；确认迁移所需的前置表、列已经具备后，按迁移与 Worker 的兼容要求安排升级。`0011` 必须与新版 Worker 切换一并进行，执行期间暂停番茄写入；不能迁移后继续使用旧 Worker。其他迁移完成后，再运行依赖新结构的 Worker。如果 `completed` 已存在，但 `0005` 尚未登记，先按下文的单项登记流程处理，再运行 `migrations apply`。

```powershell
npx wrangler d1 migrations list zsb-study-db --local
npx wrangler d1 execute zsb-study-db --local --command "PRAGMA table_info(pomodoro_records)"
npx wrangler d1 migrations apply zsb-study-db --local
```

| 迁移                                   | 作用                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `0001_maintenance_cursors.sql`         | 保存孤图扫描进度。                                                     |
| `0002_r2_cleanup_jobs.sql`             | 保存 R2 删除重试任务并建立错题图片对象键索引。                         |
| `0003_study_reward_daily_usage.sql`    | 保存学习积分每日已消耗额度，删除记录不返还当日额度。                   |
| `0004_repair_team_champion_awards.sql` | 为符合历史条件的挑战参与者补齐团队冠军徽章、通知和动态。               |
| `0005_pomodoro_completed.sql`          | 为番茄记录增加完成状态。                                               |
| `0006_align_schema_column_order.sql`   | 重建六张表，使列顺序与 `schema.sql` 完全一致，并保留现有值和 `rowid`。 |
| `0007_profile_learning_privacy.sql`   | 保存学习公开许可（默认关闭）。                                       |
| `0008_material_favorites.sql`         | 保存资料收藏状态。                                                   |
| `0009_error_review_schedule.sql`      | 保存错题复习日期与间隔。                                             |
| `0010_auth_sessions_reports.sql`      | 增加服务端会话版本、去重历史 pending 举报并建立唯一约束。             |
| `0011_data_integrity.sql`             | 保留缺失明细的旧番茄汇总基数，建立唯一打断事件，并重算日统计。         |

`0006` 重建 `community_posts`、`community_comments`、`community_messages`、`community_notifications`、`partner_study_sessions` 和 `pomodoro_records`，按列名复制所有现有值和 `rowid`，并重建原有索引。帖子和评论先复制到临时表，临时评论的外键指向临时帖子，避免删除旧帖子表时触发级联删除而丢失评论。该迁移以 `0001`–`0005` 完成后的结构为前提；旧库应通过 `migrations apply` 按顺序应用所有待执行迁移。

`0005` 将已有番茄记录的 `completed` 设为 `1`，保留历史完成语义和统计；新提前结束记录存为 `0`。该迁移使用 `ALTER TABLE ... ADD COLUMN`，不能重复执行。新库已通过快照和基线处理此列；旧库必须先完成迁移，再启动依赖该列的代码。

此前手工执行单个迁移文件的命令仍适用于缺少该列的库：

```powershell
npx wrangler d1 execute zsb-study-db --local --file=./migrations/0005_pomodoro_completed.sql
```

但是 `d1 execute --file` 不会登记迁移，不能再直接运行会重复补列的 `migrations apply`。如果 `completed` 已由手工迁移或快照加入，先确认列定义、历史值和当前结构符合 `0005`，只登记已确认完成的这一项，再应用其他未执行迁移：

```powershell
npx wrangler d1 execute zsb-study-db --local --command "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pomodoro_records'"
npx wrangler d1 execute zsb-study-db --local --command "SELECT completed, COUNT(*) AS records FROM pomodoro_records GROUP BY completed"
# 仅在已核实 0005 的结构与数据语义时执行下面两条登记命令
npx wrangler d1 execute zsb-study-db --local --command "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)"
npx wrangler d1 execute zsb-study-db --local --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_pomodoro_completed.sql')"
npx wrangler d1 migrations apply zsb-study-db --local
```

线上升级将 `--local` 换为 `--remote`。使用自定义本地持久目录时，所有初始化、查询、登记、迁移与 `wrangler dev` 命令都要追加同一个 `--persist-to`，否则会操作不同的本地数据库。

旧库若由快照或手工命令提前加入 `0007`–`0011` 的列/索引，同样要先核实每项结构与数据修复语义后逐项登记；不要使用新库的整批基线。`0011` 保留旧日汇总中没有明细支撑的部分，现有专注记录与每一条历史打断记录继续保留。旧打断记录没有事件身份，即使日期、时间、原因相同也不能据此删除；迁移按原行 ID 分配独立的 `legacy:<id>`，日统计其余部分由明细派生。迁移单调推进日汇总、事件列表的更新时间与域游标，同时保留 legacy 快照截止时间，确保已登录设备能够合并修复结果。旧 Worker 覆盖日汇总时不会更新 legacy 基数，重写打断列表时也不会保留事件 ID，因此 `0011` 不能独立提前上线。升级前备份，并在有数据的隔离副本上核查数据行数、汇总、同步游标和外键，再与新版 Worker 一并切换。`node scripts/check-migration-baseline.mjs` 使用内存数据库检查当前快照、基线名单及新增列/索引；它不会修改本地或远程用户数据库。

## 冒烟测试

冒烟测试会创建测试用户、写入本地 D1，并上传及删除测试附件。测试目标应为本地 Worker，测试脚本直接操作的 D1 必须与该 Worker 使用同一份持久目录。

在 `.dev.vars` 配置一个本地测试共享令牌，例如 `DESKTOP_TOKEN=dev-smoke-token`，重启 Worker，再另开 PowerShell 终端：

```powershell
cd worker
$env:SMOKE_DESKTOP_TOKEN = 'dev-smoke-token'
npm run smoke
```

`SMOKE_DESKTOP_TOKEN` 必须与 Worker 的 `DESKTOP_TOKEN` 相同；仅配置 Turnstile 测试密钥不足以运行该脚本，因为脚本通过共享令牌跳过验证码。

可指定本地地址，例如 `npm run smoke -- http://localhost:8788`。若 Worker 使用 `npx wrangler dev --persist-to=./.wrangler/smoke-db`，测试终端还需设置 `$env:SMOKE_D1_PERSIST_TO='./.wrangler/smoke-db'`，初始化和迁移也使用同一路径。

Node.js 22.13+ 可用 `SMOKE_D1_SQLITE` 指向该 Worker 实际使用的 SQLite 文件，以直接读写测试夹具。当前配置有 `RL_*` 限流绑定，脚本会等待限流窗口；只有本地配置确实没有这些绑定时才设置 `SMOKE_NO_RATE_LIMIT_BINDINGS=1`，此模式不验证限流行为。

覆盖范围包括 CORS、认证、跨用户隔离、业务 CRUD、增量同步与删除墓碑、学习奖励、社区、搭子、小组和附件。单元测试由仓库根目录的 `npm test` 运行；Worker 类型检查为 `npm run typecheck --prefix worker`。

## 部署

### 首次准备

当前配置指向项目现有 Cloudflare 账户、D1 数据库、R2 bucket 和域名。部署到其他账户时，先创建对应资源并修改 `wrangler.toml` 的账户、数据库、路由及 bucket 配置。

在 `worker/` 配置生产密钥，并确保 R2 bucket 存在：

```powershell
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET
# 使用桌面端时，与桌面构建和发布工作流使用同一值
npx wrangler secret put DESKTOP_TOKEN
# bucket 尚未创建时执行一次
npx wrangler r2 bucket create zsb-study-images
```

按功能需要配置 `ENCRYPT_SECRET`、`CF_API_TOKEN`、`GITHUB_TOKEN` 和 `ALERT_WEBHOOK`。部署前按上一节区分新库与旧库完成远程初始化或迁移，尤其要处理 `completed` 的结构与登记一致性。

### 手动部署与 CI

手动部署已有库的命令为：

```powershell
npm run typecheck
npx wrangler d1 migrations apply zsb-study-db --remote
npm run deploy
```

`npm run deploy` 本身只执行 `wrangler deploy`，不做检查或迁移。推送到 `master` 且修改 `worker/**`，或手动触发 [deploy-worker.yml](../.github/workflows/deploy-worker.yml)，则会先等待共享 [CI 检查](../.github/workflows/ci.yml)，再检查 Worker 类型、应用远程未执行迁移，最后部署。

部署工作流使用 GitHub Secrets `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`；这些是部署凭证，与 Worker 运行时的 `CF_API_TOKEN` / `CF_ACCOUNT_ID` 用途不同。运行时密钥仍需配置在 Worker 中。

## 认证与安全边界

- 新密码使用 PBKDF2-SHA256，迭代 100,000 次；旧 bcrypt 哈希在成功登录后升级。HS256 JWT 有效期为 3 天，登出和改密会吊销相关会话。
- Web 优先使用 HttpOnly Cookie，桌面端可使用 Bearer Token；Cookie 写请求校验来源。管理员授权回查 D1 中的角色，不只依赖 JWT 中的角色快照。
- 注册和登录分别限制为每 IP 每分钟 3 次和 10 次；已登录业务操作按用户限流。`RL_*` binding 按数据中心计数，不是全局精确配额；缺少 binding 时记录错误并放行，调用故障由入口返回服务错误。
- CORS 白名单由 `src/cors.ts` 管理。用户数据响应设置 `private, no-store`；仅允许公开图片在鉴权前使用缓存。
- 内容审核的 AI 层可降级为本地词库。定时任务分别执行，某项失败不阻止其他任务；配置告警地址后会发送失败摘要。

WAF 边缘规则需在 Cloudflare 控制台单独管理，仓库的部署工作流不创建 WAF 规则。新增或调整前核对实际 API 域名、Worker route、现有规则与套餐配额，保留原配置；按正常登录流量设置阈值，避免误拦校园网等共享出口 IP。仅覆盖 `/api/auth/login` 的规则不会保护注册、改密或其他 API。Worker 的 JSON 429 与 WAF 边缘响应分别在 Worker 日志和 Security Events 中定位；匹配共享 `DESKTOP_TOKEN` 的桌面请求会跳过 Turnstile，调整规则后应分别验证 Web 与桌面登录。

## 目录与常用命令

| 路径                                    | 职责                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| `src/index.ts`、`src/router.ts`         | 请求入口、路由注册和定时任务。                             |
| `src/auth.ts`、`src/middleware/auth.ts` | 密码哈希、JWT、Cookie/Bearer 认证、吊销与管理员校验。      |
| `src/db.ts`、`src/schemas.ts`           | D1 查询、CRUD 封装和请求校验。                             |
| `src/api/`                              | 学习、同步、奖励、附件及协作业务；社区和小组按子目录拆分。 |
| `src/proxy/`                            | 墨墨与壁纸代理。                                           |
| `src/crypto.ts`、`src/r2Cleanup.ts`     | 敏感字段加密与附件删除重试。                               |
| `src/middleware/`、`src/cors.ts`        | 认证、限流、缓存及来源控制。                               |
| `schema.sql`、`migrations/`             | 新库结构快照与已有库增量迁移。                             |
| `test/`                                 | 冒烟脚本、同步/附件检查与单元测试。                        |
| `scripts/sync-lexicon.mjs`              | 手动同步敏感词库，生成 `src/data/lexicon.ts`。             |

Worker 脚本定义见 [package.json](package.json)：`dev`、`deploy`、`init:local`、`typecheck`、`smoke` 和 `sync:lexicon`。
