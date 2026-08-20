# 社区功能 P1 四件套设计文档

> 日期：2026-08-20
> 范围：每周学习周报、成就广播、学习进度对比、热门话题运营位（社区功能 FRD 遗留 P1 项，第一批）
> 前置调研结论：项目无 cron 基础设施（Worker 仅有 fetch handler）、无系统账号发帖机制；徽章发放为请求内联触发（`awardBadge` 返回语句由调用方 batch 原子提交）。

## 1. 每周学习周报（惰性计算）

### 决策
不做 cron 预生成、不建快照表，用户请求时服务端现算。

### API
`GET /api/community/weekly-report`（需 JWT）

统计区间：**上周一 00:00 至上周日 24:00**（UTC+8，复用 `worker/src/db.ts` 的 `utc8Today` 推算 ISO 周界）。

| 指标 | 数据源与口径 |
|------|-------------|
| 学习总时长 | `study_records`：区间内 `SUM(minutes)` |
| 学习天数 | `study_records`：区间内 `COUNT(DISTINCT date)` |
| 刷题数 / 正确数 | `problem_sessions`：区间内 `SUM(total)` / `SUM(correct)` |
| 积分变化 | `points_log`：区间内 `SUM(points)`（含客户端与服务端全部来源） |
| 社区互动数 | `community_posts` + `community_comments`：`created_at`（unix 秒）区间内 COUNT |

响应示例：
```json
{
  "weekStart": "2026-08-10", "weekEnd": "2026-08-16",
  "minutes": 720, "studyDays": 5, "problems": 120, "correct": 96,
  "points": 86, "interactions": 12
}
```

幂等性：纯读计算，周界变更即自动刷新，无需缓存。

### 前端
- 新组件 `src/components/community/WeeklyReportCard.vue`，置于 `Community.vue` 广场顶部（打卡榜上方）。
- 仅当 `minutes > 0 || problems > 0` 时渲染（上周无学习数据不展示）。
- 卡片内容：指标网格 + 考试倒计时（复用 `settings.examDate`，未设置则隐藏该项）。
- 「分享到广场」：复用 `PostComposer`（`type=checkin`，presetContent 为多行文案模板，模式照抄 `LearningPathCard` 的分享实现）。

## 2. 成就广播（重大徽章自动发帖）

### 决策
服务端自动发帖（代用户发布），仅限重大徽章，用户已确认此取舍。

### 服务端
改造 `worker/src/api/badges.ts` 的 `awardBadge`：

- 重大徽章白名单：`streak_30`、`streak_100`、`likes_100`、`answer_expert`、`image_50`、`team_champion`（排除 `first_post`、`first_question`、`streak_7` 低价值事件）。
- 命中白名单且为新发放（`awardBadge` 已保证幂等，重复持有直接返回空数组）时，在返回的语句数组中追加一条 `community_posts` INSERT：
  - `type='achievement'`
  - `ref_type='badge'`、`ref_id='{badgeKey}:{userId}'`（与徽章发放同事务，天然只发一次）
  - `content`：服务端模板生成（徽章名 + 鼓励语），**跳过敏感词校验**（服务端模板内容固定）
  - **不发放积分**（不走发帖路由，防止刷分）；`circle_id` / `topic_ref` 为空，正常进公共广场
  - `created_at`：当前 unix 秒；`likes_count` / `comments_count` 冗余计数列按默认值 0

### 前端
- `PostCard`：`refType === 'badge'` 的帖子标题区加「🎖 成就达成」标识（样式同「待解答」等既有徽标体系）。
- 补齐 `src/data/defaults.ts` 的 `COMMUNITY_BADGES` 目录：新增缺失的 `team_champion`（团队冠军）条目。

## 3. 学习进度对比（opt-in 参与榜）

### 决策
- 参与机制：`user_settings` 新增 `join_progress_board INTEGER DEFAULT 0`，默认关闭，`Settings.vue` 提供开关。
- 展示：社区页（打卡榜卡片内加 Tab 切换，与今日榜/连续王并列）。
- 「匿名」解释：**默认不参与、需主动开启**即为隐私保护；上榜后与现有打卡榜一致展示真实昵称（经用户确认，不做榜上匿名化）。
- 不展示任何末位排名；只展示 TOP 50 榜单 + 自己的百分位。

### Schema
```sql
ALTER TABLE user_settings ADD COLUMN join_progress_board INTEGER NOT NULL DEFAULT 0;
```
（追加至 `schema.sql` 增量升级段；`settingsReplaceStatements` 与前端 settings 读写链路同步支持该字段。）

### API
新 `GET /api/community/progress-board`（需 JWT）：

- `weekMinutes`：`study_records` 本周一至今（UTC+8）`SUM(minutes)` 分组，仅 `join_progress_board=1` 用户，TOP 50 降序。
- `monthProblems`：`problem_sessions` 本月 1 日至今 `SUM(total)` 分组，同上 TOP 50。
- `me`：
  - 已参与：本人两项数值、排名（≤50 时榜内高亮）、百分位（`超过 X% 的同学`，分母为全部参与人数）。
  - 未参与：返回本人数值 + `joined: false`，前端显示开通引导。

响应示例：
```json
{
  "joined": true,
  "weekMinutes": { "list": [{ "userId": "...", "name": "...", "value": 640, "isMe": false }], "me": { "value": 320, "rank": 12, "percentile": 87 } },
  "monthProblems": { "list": [/* 同构 */], "me": { "value": 150, "rank": 8, "percentile": 91 } }
}
```

### 前端
- 新组件 `src/components/community/ProgressBoard.vue`：本周时长 / 本月刷题两个子榜 Tab；行样式复用 `LeaderboardBoard`（序号、头像、昵称、蓝 V、等级徽章、数值）；自己上榜行高亮。
- 挂载：`Community.vue` 现有打卡榜卡片扩展为 Tab 容器（「打卡榜」/「进步榜」两个 Tab 切换），复用卡片外壳与行样式。
- `Settings.vue`：「参与学习进步榜（展示昵称与学习数据排名）」开关。

## 4. 热门话题运营位（自动统计 + 人工干预）

### 决策
自动统计近 7 天热门 tag 为基础，管理员可置顶（强制展示、可自定义文案）与屏蔽；配置表只存干预名单。

### Schema
```sql
CREATE TABLE community_hot_topics (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,          -- 展示文案（置顶条目可自定义）
  tag TEXT NOT NULL,           -- 关联的话题 tag（含 # 前缀，与帖子 tags 同格式）
  action TEXT NOT NULL,        -- 'pin' | 'block'
  created_at INTEGER NOT NULL
);
```

### API
- `GET /api/community/hot-topics`（公开）：
  1. 读 `community_hot_topics` 全量，得 pin / block 名单。
  2. D1 JSON1：`SELECT t.value AS tag, COUNT(*) AS c FROM community_posts p, json_each(p.tags) t WHERE p.created_at >= ? AND p.is_hidden = 0 GROUP BY t.value ORDER BY c DESC`（近 7 天，unix 秒阈值）。
  3. 剔除 block 名单中的 tag，取自动 TOP；pin 名单整体前置（文案用 `text` 字段，点击仍按 `tag` 筛选）。
  4. 输出 ≤5 条：`[{ text, tag, count, pinned }]`。
- 管理接口（`worker/src/api/admin.ts`，复用 `requireAdmin`）：
  - `POST /api/admin/hot-topics`：添加 `{ text, tag, action }`（校验 action 合法、text ≤20 字）。
  - `DELETE /api/admin/hot-topics/:id`：删除干预条目。
  - `GET /api/admin/hot-topics`：当前自动统计结果 + 现有干预名单（管理界面用）。
  - 不写 `community_moderation_log`（纯运营配置，非治理动作）。

### 前端
- `Community.vue` 广场顶部 Banner：「🔥 本周热门」横向 chips，点击设置现有 `tag` 筛选（复用 store 的 `setTag`），再点取消。
- `AdminReports.vue` 新增「热门话题管理」区：展示当前自动统计结果（频次）、每条一键置顶/屏蔽；干预名单可删除；支持手动添加自定义话题（文案 + tag）。

## 统一约定

- 新 SQL 一律走 `worker/src/db.ts` 的 `all/first/run/batch`；所有写操作与关联通知在同一 `batch()` 事务内。
- 新表/新列全部追加到 `worker/schema.sql` 增量升级段。
- 前端新组件置于 `src/components/community/`，深色模式全覆盖，图标沿用内联 SVG/emoji 现有风格。
- 验证：`npx vue-tsc --noEmit` + `npx vite build` 通过，dev server 手动预览核心链路（周报分享、徽章广播帖、进步榜开关、话题 Banner 点击筛选）。

## 不做的事（明确排除）

- 不引入 cron / scheduled handler。
- 不建周报快照表（无历史回溯）。
- 不做周环比（上周 vs 上上周）对比。
- 不做自动热门话题的防刷权重（仅频次统计 + 人工屏蔽兜底）。
- 不做榜上昵称匿名化（以「默认不参与」作为隐私边界）。
