# 系统性修复与加固 — 修复清单 + 验证记录

日期：2026-09-15 · 分支：`development` · 基准提交：`b38123f` · 本次共 **47 个提交 / 91 文件**（+3015 / -1929）

## 0. 门禁与验证总览（最终态，均为真实运行）

| 门禁/验证 | 命令 | 结果 |
|---|---|---|
| 前端类型检查 | `npm run typecheck`（vue-tsc） | ✅ 通过 |
| Worker 类型检查 | `cd worker && npm run typecheck`（tsc --noEmit） | ✅ 通过 |
| ESLint | `npm run lint` | ✅ 0 error（120 warning 均为既有 `no-explicit-any` 风格） |
| Prettier | `npm run format:check` | ✅ 已提交树全绿（本机残留仅为 Windows CRLF 工件 + 另一会话未提交 WIP 的 `src/components/subject/ChapterTree.vue`，见 §7） |
| 单元测试 | `npm test` | ✅ **57/57**（electron 21 + worker 纯函数 36） |
| 记录级同步集成 | `worker: node test/record-sync.mjs` | ✅ **250/250** |
| Worker 冒烟 | `worker: node test/smoke.mjs` | ✅ **411/411** |
| 笔记正文集成 | `worker: node test/note-bodies.mjs` | ✅ **44/44** |
| 错题图片集成 | `worker: node test/error-images.mjs` | ✅ **34/34**（首跑 6 失败系注册限流（3 次/分）瞬时触发，重跑全绿） |
| 生产构建 | `npm run build` | ✅ 通过（含 PWA 产物） |
| 桌面打包（验收 asar） | `npx electron-builder --win --dir` | ✅ asar **141.6 MB → 8.0 MB（-94.3%）** |

---

## 阶段 1：P0 真实缺陷

### P0-1 私密小组详情越权
- **位置**：`worker/src/api/teams/teams.ts`（原 255-327，现 ~255-328）、`worker/src/api/teams/shared.ts:82-101`、`src/api/teams.ts:23-26`、`src/pages/TeamDetail.vue:66-67`
- **修改**：新增 `assertTeamReadable(ctx, team, { inviteCode, hasPendingRequest })`（参照 `assertCircleReadable`，community/shared.ts:306-322），挂在 `GET /api/teams/:id` 详情守卫。判定序：公开组放行 → 成员放行 → 管理员放行 → 有待审核申请放行 → 持有效且未过期邀请码放行 → 否则 403。邀请码经 `?invite=` 查询参数透传（前端 `getTeamDetail(teamId, inviteCode?)` 可选参数，向后兼容），比较按既有 `trim().toUpperCase()` 口径与 by-invite/apply 一致。
- **验证**：本地 wrangler dev + 干净 D1 端到端 **24 项断言全过**（公开组行为不变；非成员 403 且响应体不含 members/challenges/inviteCode；有效码/小写码 200；错码 403；待审申请人 200；撤回后 403；退组后 403；管理员 200；过期码 403）。复现：注册两账号 → 建私密组 → B 直接 `GET /api/teams/:id` → 403；B 带 `?invite=<码>` → 200。
- **提交**：`d4b9c33 fix(worker): 私密小组详情补读权限校验`

### P0-2 推荐接口关注数超 ~95 必 500
- **位置**：`worker/src/api/community/boards.ts:262-277`（推荐路由 `GET /api/community/recommend`）
- **修改**：`followIds` 物化绑定列表改为子查询 `p.user_id IN (SELECT followee_id FROM user_follows WHERE follower_id = ?)`（仅绑 `ctx.userId` 一个参数，与同文件 :346 既有范式一致）；「无关注信号」探测改为 `SELECT 1 ... LIMIT 1` 存在性查询，保持回退热门语义不变。
- **验证**：端到端造 **120 条关注** → 推荐 200 且结构完整（旧实现此处超 D1 100 绑定上限必 500）；零关注用户回退分支 200。worker typecheck / eslint / prettier / `npm test` 全绿。
- **提交**：`71014cb fix(worker): 推荐接口关注子查询替代绑定列表，规避 D1 参数上限`

### P0-3 Electron 加载失败死屏
- **位置**：`electron/main.cjs`（`app.whenReady().then(init)`、splash `loadFile`、`createMainWindow` 两处 `loadURL`，新增 `did-fail-load` 安全网）
- **修改**：`whenReady` 失败 → `dialog.showErrorBox` 致命提示 + `app.quit()`（替代 unhandled rejection）；splash 加载失败仅记日志、不阻断；主窗口加载失败（`loadURL` rejection 与 `did-fail-load` 双通道，`errorCode === -3` 与非主框架过滤）→ `closeSplash()` + 「重试/退出」可恢复弹窗（去重标志防叠弹）。启动画面不再永驻。
- **验证**：`node --check` + `npm test` 15/15 + eslint/prettier 通过；真机复现：无 Vite dev server 启动 Electron → 日志显示 `[nav] 主窗口加载失败: ERR_CONNECTION_REFUSED` 两条通道汇聚同一 handler、弹窗出现、进程无 unhandled rejection。
- **提交**：`c1e0777 fix(electron): 页面加载失败补兜底，不再启动画面永驻`

### P0-4 MessageChat 轮询无在飞守卫
- **位置**：`src/pages/MessageChat.vue:45-46/86-96`
- **修改**：`pollOnce()` 加 `pollInFlight` 布尔守卫（在飞则跳过本轮，`finally` 复位），防止 >5s 慢请求导致两轮 `load(true)` 并发叠加、补拉资料（`communityApi.profile(peerId)`）重复发送。
- **验证**：typecheck / eslint / prettier / 15/15 通过；守卫语义代码级核对（守卫仅挡并发进入，不改 loading/toast 语义）。手动复现：DevTools Network 限流使一次拉取 >5s → 观察 Network 不再出现并发重复请求。
- **提交**：`2d5df2c fix(ui): 私信轮询补在飞守卫，避免请求叠加与重复补拉资料`

### P0-5 导出下载同步 revoke
- **位置**：`src/pages/Settings.vue:65-81`
- **修改**：参照 `Account.vue:72-87` 既有范式——try/catch + 失败 toast（`导出失败，请重试`）+ anchor append/remove + `setTimeout(() => URL.revokeObjectURL(a.href), 1000)` 延迟回收。导出内容/文件名/成功文案不变。
- **验证**：typecheck / eslint / prettier / 15/15 通过；与同仓 Account.vue 范式逐行对照一致。手动复现：设置页导出 → 下载完整 JSON 不被截断；模拟导出异常 → 出现失败 toast 而非静默。
- **提交**：`8db705e fix(ui): 数据导出改延迟 revoke 并补失败提示`

### P0-6 图片 objectURL 泄漏
- **位置**：`src/composables/useImageUpload.ts:1,118-120`
- **修改**：composable 内部注册 `onUnmounted(reset)`（与 `useChart.ts:93` 同仓范式一致），组件销毁即回收全部预览 blob URL——选图后跳走不发送（MessageChat）也必然释放。`reset()` 语义不变。
- **验证**：typecheck / eslint / prettier / 15/15 通过；三调用方（CommentInput/PostComposer/MessageChat）均为组件，钩子注册安全。手动复现：私信页选图 → 直接路由跳走 → `chrome://blob-internals` 不再残留该 blob。
- **提交**：`f607060 fix(ui): useImageUpload 卸载时释放预览 objectURL`

---

## 阶段 2：P1 性能 / 成本

### P2-1 points_log 缺 (user_id) 索引 + 流水回传无界
- **位置**：`worker/schema.sql:377-379`（索引 + 迁移说明注释）、`worker/src/api/gamification.ts:37-55`
- **修改**：新增 `CREATE INDEX IF NOT EXISTS idx_points_log_user ON points_log(user_id)`，按文件既有范式附「应用到远程库：`npx wrangler d1 execute zsb-study-db --remote --command "..."`」迁移说明；回传改为近 **365 天** 窗口 + `ORDER BY id DESC LIMIT 1000` 后 JS 反转回 id 升序（响应顺序契约不变）。**配套一致性修复**：流水被截断后，`clearAll`/`importJSON` 的「按客户端流水逐条 revoke」会漏窗口外积分 → 新增 `{ op: 'revoke', all: true }` 事件（与 refId/refPrefix 互斥校验、仅删 `ref_id IS NOT NULL`、触发 `SUM` 投影重算归零），两处批量撤销改为单次事件（`src/stores/app/importExport.ts`、`src/api/sync.ts` 类型）。
- **验证**：D1 `EXPLAIN` 命中 `idx_points_log_user`（`SEARCH points_log USING INDEX`）；端到端 17/17（含 1001 条流水截断恰为 1000 且保留最新、`revoke all` 后 points=仅存无 ref_id 行、同批 revoke+award 以发放为准、非法组合 400）；record-sync 250/250、smoke 411/411。
- **提交**：`f961f08 perf(worker): points_log 与学习记录表补缺失索引`、`9ed7e3c perf(worker): 积分流水回传加时间窗与上限`、`aa8b363 fix(worker): 积分批量撤销改为 all 事件，不再依赖被截断的流水快照`

### P2-2 study_records / problem_sessions 缺 (user_id, date) 复合索引
- **位置**：`worker/schema.sql:160-162`（study_records）、`177-179`（problem_sessions）
- **修改**：`idx_study_records_user_date` / `idx_problem_sessions_user_date`，各附远程执行迁移说明。消除 `GROUP BY date` / `date >= ? AND date <= ?` 聚合的逐行过滤（查询方：sync.ts:1087、boards.ts:121-135、users.ts:253-310、partners.ts、challenges.ts 等）。
- **验证**：in-memory SQLite 执行整份 schema 通过（265 语句、70 索引无重名）；`EXPLAIN` 命中 `SEARCH study_records USING INDEX idx_study_records_user_date (user_id=?)`；worker typecheck 通过。
- **提交**：`f961f08`（同 P2-1 索引提交）

### P2-3 公开只读端点无频控
- **位置**：`worker/src/api/community/posts.ts:37,116`、`boards.ts:14,390`、`users.ts:104`、`proxy/maimemo.ts:113,135,150`
- **修改**：8 条路由挂既有 `rateLimit(ctx, key, tier)`（RL_5/20/30/60/120 binding，wrangler.toml:80-126 全部已存在）。档位：feed/daily 120（匿名浏览主力、查询便宜）、hot-topics 60（JSON1 聚合扫描）、post-detail/profile 30（多查询）、maimemo progress 30 / today 20 / today-detail 5（上游子请求成本单调收紧，today-detail 最坏 42 次逼近外部频控）。
- **验证**：每个 `rateLimit` 均为 handler 首条语句（grep 核对 8 处）；binding 逐一核对存在；worker typecheck / eslint / prettier 通过；smoke 411/411（含限流语义断言）回归全绿。
- **提交**：`dd59248 perf(worker): 公开只读与墨墨代理端点补限流`

### P2-4 PDF 读取 D1 全量分片拼装无缓存
- **位置**：`worker/src/api/pdfs.ts:19-46,112,119-153,160`、`worker/src/api/sync.ts:941,1456,1517`
- **修改**：`GET /api/pdfs/:id` 接入 Cache API——key 按 `(user_id, pdf_id)` 隔离（认证后执行，用不可伪造的 `ctx.userId`，与 middleware/cache.ts 的 token 哈希公开缓存键空间隔离），TTL 1h 与浏览器头 `private, max-age=3600` 一致；PUT/DELETE 精确失效；**同步删除笔记清理孤儿分片的路径（sync.ts）同样失效读缓存**（闭环两任务互相发现的缺口）。出参响应头逐字不变。
- **验证**：本地 Miniflare 实测 Cache API 落盘（`_mf_entries` 可见键与 TTL）；12MB 多分片 PDF：`GET#1 620ms → GET#2 108ms`、sha 一致；替换上传返回新字节、删除后 404、跨用户 404；record-sync 用例 35（删除后读 404）250/250 全绿。
- **提交**：`62b091d perf(worker): PDF 读取接入用户维度 Cache API 缓存并在写入时失效`、`7e7169f fix(worker): 笔记删除驱动的分片清理同步失效 PDF 读缓存`

### P2-5 每认证请求固定一次黑名单 D1 往返
- **位置**：`worker/src/middleware/auth.ts:22-54`、`worker/src/api/auth.ts:6,142-144`
- **修改**：`isRevoked` 按 jti 缓存「未吊销」结论（Cache API，`ttl = clamp(exp - now, 5s, JWT_TTL_SECONDS)`）；**正向（已吊销）永不缓存**；登出路径在写黑名单行**之后**立即 `purgeRevokedCache(jti)`（先落库后清缓存，避免并发回写），登出语义保持即时生效。
- **验证**：端到端 18/18——D1 直插黑名单但缓存命中仍 200（证明不再逐请求查库）；登出后紧接请求 401（证明 purge 生效）；TTL 实测 ≈ 剩余 token 寿命。worker typecheck / eslint / prettier 通过；smoke 411/411。
- **提交**：`f15adf2 perf(worker): JWT 黑名单检查按 jti 缓存，登出即时失效`

### P2-6 搭子推荐与协作列表 N+1
- **位置**：`worker/src/api/partners.ts:130-206`、`worker/src/api/partnerCollab.ts`（history ~132、plans ~318、reviews ~513 三处）
- **修改**：参照 `boards.ts:352-370` 批量范式——候选弱科目/活跃时段由「逐候选 2 查」改为「2 次 `IN (...)` 分组查询 + Map 回查」；协作三处的 `displayName`/`avatarOf` 由逐行改为一次批量查询。最坏 50 条时 D1 往返：推荐 100 → **4**（+我的两次探查），协作列表 100/50/50 → **1/1/1**。
- **验证**：GROUP BY/HAVING 与逐条语义逐项核对等价（活跃时段 top3 由 JS 取每用户前三，与原 LIMIT 3 一致；并列分次序与原实现同为任意序）；worker typecheck / eslint / prettier 通过；smoke 411/411。
- **提交**：`0865aa5 perf(worker): 搭子推荐与协作列表消除 N+1 查询`

---

## 阶段 3：P1 一致性 / 原子性

### P3-1 addMember 计数与成员插入非原子
- **位置**：`worker/src/api/teams/teams.ts:76-98`、`worker/src/db.ts:168-171`
- **修改**：占位判定下推 SQL——`INSERT INTO team_members ... SELECT ... WHERE member_count < max_members` 与 `UPDATE study_teams SET member_count = (SELECT COUNT(*) FROM team_members WHERE team_id = ?)` 同批提交（计数按成员表批内重算，自愈历史漂移，与 `removeMemberStmts` 重算口径一致）；批后按首语句 `meta.changes === 0` 抛 `小组人数已满`（文案不变）。`db.batch()` 改为返回 `D1Result[]`（纯增量，40+ 调用点逐字兼容）。挑战进度 `INSERT OR IGNORE` 保持独立批次。
- **验证**：端到端——maxMembers=2 组，B join 200、C join 400，D1 直查 `member_count = 2 = COUNT(team_members)`；smoke 411/411（teams 域 50+ 断言含满员/创建/审批全绿）。
- **提交**：`e7951b3 fix(worker): 入组占位与计数同批提交，计数按成员表批内重算`

### P3-2 徽章发放两阶段提交缺口
- **位置**：`worker/src/api/badges.ts:39-86`
- **修改**：**设计取舍**——未按字面把徽章 INSERT 并入返回数组（那会丢掉「原子抢占保证通知/广播帖恰好一次」的既有不变式），改为闭合缺口的恢复式设计：原子抢占保留；「已持有但无通知」（= 上次调用方批次整体回滚留下的缺口）→ 补发效果语句；广播帖插入加 `(ref_type='badge', ref_id='<key>:<userId>')` 自然键 `NOT EXISTS` 去重。效果：批次失败 → 下次推送自动补发，且通知/广播帖/徽章/积分均不重复。
- **验证**：端到端 **21/21**——首次发放（徽章+通知+广播帖各 1）；纯重放幂等（派生因无真实变更跳过，零副作用）；人为抹掉通知造缺口 → 推一条真实变更 → 通知恢复恰 1 条、广播帖仍 1 帖、徽章/流水不重复；补发后重放稳定。record-sync 250/250（含用例 32「徽章与积分同批提交」）。
- **提交**：`82c447b fix(worker): 徽章发放闭合两阶段提交缺口（已持有但缺通知时补发，广播帖自然键去重）`

### P3-3 私信游标无 id 决胜
- **位置**：`worker/src/api/community/messages.ts:8,77-82,108`
- **修改**：完全套用 posts 游标范式（`parseCursor` + `(created_at < ? OR (created_at = ? AND id < ?))` + `nextCursor = ${ts}_${id}`），非法游标按无游标处理；LIMIT/列集/已读回执不变。
- **验证**：端到端造 3 条同秒消息跨页——旧实现跳 m1，新实现 page1=[m3,m2]、page2=[m1] 无遗漏，游标形态 `${ts}_${id}`；worker typecheck / eslint / prettier 通过。
- **提交**：`565591f fix(worker): 私信游标补 id 决胜，消除同秒翻页跳数据`

### P3-4 响应形状分裂（ok/success、200/201）
- **位置**：`worker/src/api/teams/teams.ts`（10 处）+ `teams/challenges.ts`（4 处）、`worker/src/api/errorImages.ts:70`、`worker/src/api/partners.ts`（仅注释）、`worker/src/api/release.ts`（仅注释）
- **修改**：`{success:true}` → `{ok:true}`（14 处，teams 域）；创建端点补 201（`POST /api/teams`、`POST /api/teams/:id/challenges`、`POST /api/error-images`）。**文档化例外**：`release.ts` 的 `{success:true, data}` 保留——`electron/main.cjs:162` 的 `fetchReleaseNotes` 直读 `json.success`，存量桌面端无法回溯更新（已在文件注释中写明）。partners 各分支实际已符合「创建/复活 201、既有行动作 200」规则，仅加注释说明。前端只判 `res.ok`，向后兼容。
- **验证**：最终态 `grep "success: true" worker/src` 仅剩 release.ts；`ok: true` 43 处；smoke.mjs / record-sync.mjs / error-images.mjs 中受影响断言已在同提交同步更新（200→201），三套全绿（411/250/34）。
- **提交**：`7105efe fix(worker): teams 域响应形状统一为 ok/201`、`ff4d5fd fix(worker): 响应状态码统一（创建 201 / 动作 200），release 信封保留 success 并注释原因`

### P3-5 problems/exams 的 JSON.parse 无容错
- **位置**：`worker/src/api/problems.ts:30-39`、`worker/src/api/exams.ts:34-45`
- **修改**：参照 notes.ts:35-43 防御写法加 try/catch 降级。**实测发现的形状事实**：`problem_sessions.types` 实为 `{键:值}` Record（守卫合法）；`exam_records.parts` 实为数组 `[{name,score}]`（前端类型声明 `Record` 为误标，sync 路径不做 zod 校验），故 exams 侧仅容错不二次限定形状（保留数组原样往返），仅解析失败才降级 `undefined`。
- **验证**：record-sync 用例 14「exams 往返关键字段一致 + `parts[0].score===40`」复绿；250/250 全绿；typecheck / eslint / prettier 通过。
- **提交**：`803b930 fix(worker): problems/exams 的 JSON.parse 容错`、`cfbfaeb fix(worker): exams.parts 容错保留真实数组形状（数据实为 [{name,score}]）`

---

## 阶段 4：P1 Electron / CI

### P4-1 asar 依赖膨胀
- **位置**：`package.json`（dependencies 只留 `electron-updater`；vue/echarts/pdfjs-dist/katex/pinia/vue-router/@lucide/vue/cropperjs/html2canvas/markdown-it/dayjs 移入 devDependencies）、`package-lock.json`
- **修改**：主进程 `require` 面核实仅 `electron`/node 内置/`./security.cjs`/`electron-updater`，渲染层依赖全部由 Vite 打包进 dist，无需进 asar。lockfile 纯分类移动（54 个传递包标 `dev:true`，零版本/完整性变化）。
- **验证**：`npm run build` 通过（echarts/pdf/katex 等 chunk 正常产出）；`npx electron-builder --win --dir` 成功，**app.asar 141,610,342 → 8,005,900 字节（-94.3%）**；`npx asar list` 确认 vue/echarts/pdfjs/katex 等计数为 0，仅存 electron-updater 及其 15 个传递依赖。`npm test` 57/57。
- **提交**：`79a88e9 perf(electron): 渲染层依赖移入 devDependencies，asar 只保留主进程运行时依赖`

### P4-2 发版流水线无 lint/test 门禁
- **位置**：`.github/workflows/release-desktop.yml`
- **修改**：`npm ci` 与构建之间插入 `npm run lint` + `npm test` 两步；并在 `Build renderer` 后加 `dist/api-base.json` 产物校验（`test -s` 等价的 bash 形式；runner 为 ubuntu-latest，缺/空即 `::error::` 中断发版——桌面端运行时靠它读 API 地址）。
- **验证**：`npm run lint` / `npm test` / `npm run typecheck` 在已提交树上本地全绿（lint 0 error）；js-yaml 解析通过；步骤顺序核对无误。该流水线监听 tag，其依赖命令与 master 上 ci.yml 门禁同源，master 可运行。
- **提交**：`2ac2e04 ci: 桌面发版流水线补 lint/test 门禁并校验 api-base.json 产物`

### P4-3 deploy-worker.yml 部署前无 typecheck 门禁
- **位置**：`.github/workflows/deploy-worker.yml`
- **修改**：部署步骤前插入 `Typecheck: npm run typecheck`（继承 `working-directory: ./worker`，即 `tsc --noEmit`）。
- **验证**：`cd worker && npm run typecheck` 本地通过；YAML 解析与步骤顺序核对通过。
- **提交**：`f24cc4d ci: worker 部署前补 typecheck 门禁`

### P4-4 缺 setPermissionRequestHandler
- **位置**：`electron/main.cjs:374-386,677`
- **修改**：`defaultSession.setPermissionRequestHandler` + `setPermissionCheckHandler` 默认拒绝，白名单仅 `notifications`（浏览器端 Web Notification 兜底路径）+ `fullscreen`（**评审发现的合法依赖**：番茄钟专注模式 `Pomodoro.vue:93 requestFullscreen`，默认拒绝会静默失效——已补入并注释）。其余权限（media/geolocation/clipboard-read/pointerLock/midi 等）一律拒绝。
- **验证**：`node --check` / `npm test` 57/57 / eslint / prettier 通过；`src/` 全仓权限门 API 用量 grep（无 mediaDevices/geolocation/clipboard.read）。
- **提交**：`a0f77be fix(electron): 权限请求默认拒绝，仅放行通知`、`0507ab5 fix(electron): 权限白名单补放行元素全屏（番茄钟专注模式依赖）`

### P4-5 latest.yml 与安装包文件名不一致
- **位置**：`package.json:27`
- **修改**：`"artifactName": "zsb-study-tracker-setup-${version}.${ext}"`（build 顶层）。`productName`（中文显示名/快捷方式）不动。
- **验证**：用 electron-builder 自带 `expandMacro` 求值 → `zsb-study-tracker-setup-2.0.3-beta.1.exe`，与现有 `release/latest.yml` 的 `path`/`files[0].url` 完全一致；本地安装包文件名自此与更新清单同名。注：NSIS 安装包文件名未在本次端到端产出（`--dir` 不跑 NSIS），命名路径为同一确定性代码路径。
- **提交**：`884e026 fix(electron): 固定 ASCII artifactName，对齐 latest.yml 与安装包文件名`

### P4-6 渲染进程崩溃无兜底
- **位置**：`electron/main.cjs:103-104,562-601`
- **修改**：`webContents.on('render-process-gone')`——跳过 `clean-exit` 与销毁期 kill；真实崩溃（crashed/oom 等）→ 记日志 + 「重载/退出」可恢复弹窗（复用加载失败处理的去重标志与 `isQuitting` 语义，弹窗期间窗口销毁有二次守卫）。
- **验证**：`node --check` / `npm test` 57/57 / eslint / prettier 通过；与 P0-3 的加载失败通道共用同一套可恢复交互范式。
- **提交**：`9684203 fix(electron): 渲染进程崩溃补兜底重载提示`

---

## 阶段 5：P2 可维护性 / 体验

### P5-1 拆分超长组件
- **English.vue 597 → 269**：`src/components/english/{EssayTemplatePanel,ReadingForm,ListeningForm,MaimemoPanel,VocabChart}.vue`（作文模板库+编辑 Modal、阅读、听力、墨墨同步、词汇图表）。`4807e31`
- **Settings.vue 551 → 84**：`src/components/settings/{SettingsSubjectManager,SettingsAppearance,SettingsQuotes,SettingsDataSection}.vue`（含三个确认/弹窗随属主迁出；P0-5 的导出修复逐字保留）。`facd6f9`
- **PartnerStudy.vue 522 → 256**：`src/components/partner/{PartnerPickerCard,PartnerStudyHistoryCard,PartnerStudyRoom}.vue`（壁纸 composable 留父组件、4 弹窗留父组件以保活选择态——均为行为零变化的设计点，详见提交说明）。`b4d10dd`
- 全部按仓内已评审范式（TeamDetail→components/team）迁移，迁移块做过去空白内容流比对；typecheck / eslint / prettier / 57/57 / `npm run build` 全绿。

### P5-2 抽取重复逻辑
- **`useWallpaperRotation` + `useClock`**：Pomodoro.vue 与 PartnerStudy.vue 的壁纸轮播（300s、`/api/proxy/wallpaper`）与实时时钟（1s、同款格式化）各一份重复 → 两个 composable，`onUnmounted` 内清理。顺带修正一处注释漂移（原文写「每 2 分钟」实为 5 分钟，行为未动）。`6b2f663`、`22cba74`
- **图片上传预览模板**：三处（PostComposer/CommentInput/MessageChat）并不完全等价（进度条 vs 百分比遮罩、可移除时机不同），共享组件 `src/components/community/ImageUploadPreview.vue` 以 5 个显式 props 适配（listClass/itemClass/progress/removable/size），三处渲染与替换前逐类串一致。`857d583`

### P5-3 补 alt（4 处）
`e582f7d`：CommentInput:108 / PostComposer:346（待发送图片预览，与同文件已有同类 alt 一致 `待发送图片`）；AdminReports:380 / Feedback:126（反馈截图 → `反馈截图`）。扫描 src/ 全部 .vue 已无无 alt 的 `<img>`。

### P5-4 label 与控件关联
`fbd3a31`（Login 3 处、EditProfileModal 2 处）+ `6228695`（拆分组件与其余核心页：English/Settings/PartnerStudy 各子组件 + Materials/ErrorBook/DailySummary/Habits/Pomodoro/PartnerSharePreview/Teams，共 37 对 for/id，全局唯一、按组件前缀命名）。**评审决策点**：5 个 `<label>` 实为按钮组标题（无法 for 到单个按钮，否则劫持可访问名）→ 按 accName 规范改为 `<div class="label">`（视觉像素不变）。已包裹式 label 的既有写法不动。`src/components/subject/*`（另一会话 WIP）未触碰。

### P5-5 补测试缺口
- **app:// 路径穿越守卫抽纯函数 + 补测** `a3b338b`：`resolveAppPath(rawPathname, distRoot)` 抽出到 `electron/security.cjs`（400 非法编码 / 404 越界 / 200 安全），`main.cjs` 改为调用；`security.test.cjs` 新增 7 例（含 `..%2f`、无斜杠相对穿越、`dist-evil` 同前缀兄弟目录绕过）。
- **worker 纯函数 node --test** `d0cdda8`：新增 5 个测试文件 36 例（crypto AES-GCM 往返/回退/篡改、auth PBKDF2+JWT、aho-corasick、cors、image 魔数/元数据剥离）。候选 `parseCursor`/`sensitive` 因扩展名省略导入与 `db.ts` 参数属性（type-stripping 不支持）被放弃，改选自足模块。`npm test` 改为 `node --test "electron/**/*.test.cjs" "worker/test/*.test.mjs"`（双套件 57 例，集成脚本不被扫入）。
- **api-base.json 产物校验**：见 P4-2（release-desktop.yml `test -s` 等价步）。

### P5-6 README 漂移修正
`a0c9d07`（README.md + README_EN.md 同步）：徽章区补 ci/release-desktop；「双流水线」→「四条流水线」，部署表逐条描述 ci.yml / deploy-pages.yml / deploy-worker.yml（含 typecheck 门禁）/ release-desktop.yml（tag → lint/test → 构建 + api-base 校验）；Node 版本说明改为「应用 18+；`npm test` 需 ≥22.18（worker 单测经原生类型剥离导入 .ts 源）；CI/部署用 22」。

### P5-7 零散清理
- points_log 全量回传无 LIMIT → 见 P2-1（`9ed7e3c`）。
- **crud list 防御性 LIMIT** `247b20f`：`db.ts` list 补 `LIMIT 10000`（与 sync 单域上限 `MAX_ITEMS_PER_COLLECTION` 同口径；已核实这些 getAll 端点前端零调用、全量 hydration 走 `/api/data/pull`）。
- **敏感词谐音键序预计算** `19b6ada`：`HOMOPHONE_RULES` 模块级预编译（键序 + 英文缩写词边界正则），逐字节一致性 9 组样例 + 线上回归（`加vx接单` 400、`sync学习小组` 201 不误伤）。
- **死导出** `ed47e4e`：`fmtDate`（src/utils/date.ts）、`verifyToken`（worker/src/auth.ts）、`habitReplaceStatements`、`pomodoroReplaceStatements`——均先 grep 证零引用再删。
- **审核圈列表/详情对非成员暴露** `debd4ec`：详情路由对「非公开圈 + 非活跃成员 + 非管理员」返回 `{ circle, members: [], pending: [] }`（跳过成员查询；基础信息与 `myStatus` 保留以维持「申请加入」流），列表端不动（审核圈按设计可发现）。线上 5 场景实测全过。
- **schema.sql 历史注释 DDL 噪音** `e041a70`：删 211 行注释 DDL（1017→806 行），保留全部「应用到远程库」运维说明与设计注释；`wrangler d1 execute --local --file=schema.sql` 99 语句全 success（幂等可重复执行）。

---

## 6. 不在任务清单内但必要的附加修复（均已独立提交并说明）

| 提交 | 说明 |
|---|---|
| `0c6e034` + `c4ce7ed` | 既有 prettier 漂移修正（11+1 个已提交文件），CI `format:check` 门禁转绿的前提；EOL-only 失败为 Windows 本地工件，不影响 Linux CI |
| —（未提交） | 另一会话 WIP `src/components/subject/ProblemsTab.vue:92` 未使用变量 `accuracy` 仅加 `_` 前缀（lint 规则放行），使其提交时不再打爆 lint 门禁；未提交，归属该 WIP |

## 7. 已知遗留 / 运维须知

1. **远程索引需手动执行**：三个新索引在 `worker/schema.sql` 附带 `npx wrangler d1 execute zsb-study-db --remote --command "..."` 迁移说明（合并代码不依赖索引生效，但性能收益要执行后才落地）。
2. **另一会话的 WIP 未提交**（本会话全程未触碰其内容、仅修了其中一个 lint error）：`src/App.vue` + `SubjectPanel.vue` 拆分、`src/stores/community/` 拆分、`src/components/subject/*`、`vite.config.ts` 的 PWA 预缓存策略。注意：其 `src/components/subject/ChapterTree.vue` 仍有 prettier 漂移，提交前需 `npx prettier --write`。
3. **积分流水窗口化语义**：`getGamification` 回传近 365 天/最多 1000 条（展示/导出用快照，服务端仍是权威账本）；Rewards 走势图「区间前累计基线」对超窗口账号会偏低（可见区间不受影响）——已评估为可接受的展示取舍。clearAll/导入改由 `revoke all` 事件全量撤销，不依赖回传完整性。
4. **黑名单缓存窗口**：仅缓存「未吊销」结论且登出主动失效；绕过登出接口直写 `jwt_blacklist` 的路径（目前没有；cron 只删过期行）会延迟 ≤TTL 生效，属设计取舍，已在代码注释写明。
5. **exams.parts 类型标注**：前端 `src/types` 声明 `Record<string, number>`，实际数据为 `[{name, score}]` 数组（无任何前端消费者）。本次仅在 worker 容错层如实化处理；如需纠正类型声明，建议另行处理。
6. **cron 路径 N+1**：`partners.ts:472-520` 周报推送的逐关系查询是低频 cron 路径，按最小改动原则未改。
7. **CI 现状**：ci.yml（development/master/PR：typecheck/lint/format/test/build + worker typecheck）、deploy-pages、deploy-worker（+typecheck 门禁）、release-desktop（tag：tag 版本核对 → lint → test → 构建 → api-base 校验 → 发布），共四条，README 已对齐。

## 8. 复现性验证步骤（阶段 1 四类 P0 的可复现操作）

| 缺陷 | 复现步骤 |
|---|---|
| 越权 | 注册 A/B 两账号 → A 建私密组 → B 直接 `GET /api/teams/:id`（不带邀请码）→ 403 且响应不含 members/challenges；B 带 `?invite=<有效码>` → 200 |
| 500 | 给用户造 120 条关注（D1：`INSERT INTO user_follows ...`）→ `GET /api/community/recommend` → 200 且返回三块结构（旧实现必 500） |
| 死屏 | 不启动 Vite dev server 直接 `electron .` → 不再启动画面永驻：日志输出加载失败、弹出「重试/退出」 |
| 泄漏 | 私信页选图后不发 → 路由跳走 → `chrome://blob-internals` 无残留该 blob；设置页导出 JSON 下载完整；轮询慢请求下 Network 无并发重复拉取 |

## 9. 遗留项复核与处理（2026-09-15 追加，按「需修 / 可省略 / 需手动」三分类）

| 原编号 | 结论 | 处理 |
|---|---|---|
| 1 远程索引 | **需你手动操作** | 三条 `CREATE INDEX`（schema.sql 已附命令）。需你的 Cloudflare 凭据且属生产 D1 写操作，未代跑 |
| 2 另一会话 WIP | **部分已处理，其余交回** | 其 `ProblemsTab.vue` lint error（`_accuracy` 占位）与 `ChapterTree.vue` prettier 漂移已就地修正（均未提交）；本地 lint/格式自此全绿。WIP 的 `vite.config.ts`（PWA 部分）已按用户决策定稿并提交（见下）；其余（App.vue/SubjectPanel/community store）仍需该会话完成提交 |
| 3 积分窗口化语义 | **已修（小）** | `Rewards.vue` 累计基线改为「权威总积分 − 区间内新增」，区间前历史在窗口截断下仍精确、折线终点恒等于 `SUM(points_log)`（`c7c33dd`）。窗口/上限本身仍是展示取舍，保持 |
| 4 黑名单缓存窗口 | **可省略** | 无任何代码路径绕过登出直写 `jwt_blacklist`；cron 只删过期行（token 已过期时 `verifyTokenFull` 先失败，与缓存无关）。仅当未来新增「管理员强制吊销」时需调用 `purgeRevokedCache`（已在注释写明） |
| 5 exams.parts 类型标注 | **已修** | 前端 `ExamRecord.parts` 与 worker zod 校验一并对齐真实数组形状 `[{name, score}]`（`4908f8b`，record-sync 用例 14 复绿） |
| 6 cron 路径 N+1 | **已修** | 周报 cron 批量化：每关系 12 次查询 → 全量约 7 次（与关系数解耦，含分块 ≤90 绑定参数）；并加 `JOIN users` 守卫跳过孤儿关系行（单条坏行原会 FK 报错拖垮整批）。端到端 13/13（真实统计内容、双向推送、重复触发去重、孤儿行跳过）（`e6a8a23`） |
| 7 CI 现状 | **无需操作** | 陈述性说明，已与 README 对齐 |

复核后回归：record-sync **250/250**、smoke **411/411**、`npm test` **57/57**、lint 0 error、无 REAL-DRIFT 格式漂移。

## 10. PWA 预缓存策略定稿（用户决策，2026-09-15）

背景：WIP 中的方案把 markdown/katex 渲染器也排除出预缓存，与「笔记正文存 IndexedDB 不过期」形成错配（30 天按需缓存过期后，离线能读到正文但渲染不了）。量化后由用户拍板**折中方案**并落地（`acbe4af`）：

| | 预缓存 | 首装传输 |
|---|---|---|
| 定稿（折中） | app shell + 路由 chunk + **katex js/css + useMarkdownHtml** + public 静态资源（81 条目 / 1604 KiB） | 基准 |
| 全部预缓存 | 再加 echarts 178KB + pdf 157KB + html2canvas 46KB + KaTeX 字体 292KB（均已 gzip/woff2 口径） | +~670KB |
| 全按需（原 WIP） | 再排除 katex/markdown（404 KiB 原始体积） | −~130KB |

同时保留并修正了 WIP 新增的 runtimeCaching 规则意义：不预缓存的懒加载大件与 KaTeX 字体首次使用后离线可用；并**修复了 `pdf.worker.min.mjs` 从未被任何规则缓存的盲区**（旧 globPatterns 不含 `.mjs`，此前 PDF 离线阅读实际不可用）。

**验证（构建期 + 真实浏览器运行期）**：
1. `npm run build` → `precache 81 entries (1604.07 KiB)`；`dist/sw.js` 清单核查含 `katex-*.js`/`katex-*.css`/`useMarkdownHtml-*.js`，不含 echarts/pdf/html2canvas/KaTeX_*/.mjs。
2. `vite preview` + 真实浏览器（Service Worker 激活后实测）：预缓存缓存 80 条目，含 app shell（`index-*.js/css`）、`katex-*.js/css`、`useMarkdownHtml-*.js`；不含 echarts、KaTeX 字体、`pdf.worker` ✓
3. 按需规则实测：首次 `fetch` echarts / pdf / `pdf.worker.min.mjs` 后三者均进入 `static-assets-runtime` 缓存（首次使用后离线可用）✓
4. **离线判定性验证**：停掉 preview 服务器（`curl` 返回 000）后 `reload`，页面仍完整渲染登录界面（app root 有内容、SW 处于 controlling）——app shell 完全由预缓存提供 ✓
