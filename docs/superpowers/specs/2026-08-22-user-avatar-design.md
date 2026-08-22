# 用户自定义头像（#1）设计文档

日期：2026-08-22
状态：已批准（裁剪采用交互式 cropperjs；不做「移除头像」功能）

## 1. 背景与目标

- **现状**：用户无法自行配置头像，所有展示位使用「首字母 + 渐变底色」占位（`UserAvatar.vue`）。
- **目标**：用户可上传、裁剪（1:1 正方形）头像并全局生效；未配置时维持首字母兜底。

## 2. 数据模型

- `user_settings` 表新增 `avatar TEXT DEFAULT NULL` 列，存头像相对 URL（如 `/api/avatar/abc123def4567890.webp`）。
- **关键约束**：`settingsReplaceStatements`（`worker/src/api/settings.ts`，settings 全量同步通道）**不包含** avatar 列。多设备 `PUT /api/settings` 永远不会覆盖头像；头像只能通过专用上传接口修改。
- 已建库升级（执行一次）：`ALTER TABLE user_settings ADD COLUMN avatar TEXT;`
  新库直接在 `CREATE TABLE user_settings` 中含该列。`schema.sql` 顶部注释区同步登记。

## 3. 后端存储与接口

### 3.1 为什么不写 `community_uploads` 表

`cleanupOrphanUploads`（`worker/src/api/uploads.ts`）会清理「30 天未被帖子/评论/反馈引用」的上传记录。头像若记在该表，且 30 天内用户未发帖，会被误删。因此：

- 头像走**独立 R2 key**：`avatars/<uid>.<ext>`（uid 为 16 位 hex）。
- 元数据只存 `user_settings.avatar` 字段，不进 `community_uploads`。

### 3.2 上传接口（新增分支，复用现有逻辑）

`POST /api/community/upload?variant=avatar`（auth=true，实现在 `uploads.ts` 现有路由内加分支）：

1. 限流 `avatar:upload`，10 次/分钟（换头像频率低）。
2. 复用 magic bytes 嗅探 + EXIF 剥离（stripJpeg/stripPng/stripWebp）；**仅允许 PNG/JPEG/WebP，拒绝 GIF**；沿用 5MB 上限（前端裁剪后实际远小于此）。
3. 生成新 uid，R2 put `avatars/<uid>.<ext>`。
4. 读取 `user_settings` 旧 avatar 值，解析旧 R2 key 并删除（失败仅记日志，不阻塞）。
5. 更新 `user_settings.avatar = '/api/avatar/<uid>.<ext>'`。
6. 返回 `{ url }`。

**缓存策略**：每次上传生成新 uid → URL 变化，天然规避读取端 `immutable` 长缓存导致的旧图问题。

### 3.3 读取接口（新增公开路由）

`GET /api/avatar/:file`（auth=false）：

- file 格式校验：`^[a-f0-9]{16}\.(png|jpg|webp)$`，非法直接 400。
- 从 R2 读 `avatars/<file>`，按扩展名设置 `Content-Type`。
- 响应头：`Cache-Control: public, max-age=31536000, immutable`、`X-Content-Type-Options: nosniff`。
- 不存在返回 404（头像被删或未设置）。

### 3.4 avatar 字段下发

凡 JOIN `user_settings` 取 `user_name` 的 SQL 顺手带出 `s.avatar`，响应字段统一命名 **`userAvatar`**（与其他 `userName`/`userVerified` 模式一致）：

| 文件 | 场景 |
|---|---|
| `community.ts`（12 处） | 帖子列表（POST_SELECT）、评论、资料卡、排行榜、进步榜、通知 actor、私信 peer、圈子成员/申请、推荐关注 |
| `partners.ts`（3 处） | 学习搭子列表 |
| `teams.ts`（1 处） | 小组成员列表 |

`admin.ts` 的举报/审核列表本次不接（管理后台非头像展示位验收范围）。

## 4. 前端

### 4.1 依赖

- `cropperjs`（约 40KB gzip）：交互式裁剪，`aspectRatio: 1`、拖拽 + 缩放选区。

### 4.2 `UserAvatar.vue`（改造）

- 新增 `avatar?: string` prop。
- 有值且以 `/api/avatar/` 开头时：渲染 `<img :src="imageUrl(avatar)">`，`object-cover rounded-full`；`onerror` 回退首字母。
- 无值 / 加载失败：维持现有「首字母 + 渐变底色」。
- 支持外部 class 覆盖尺寸（现有用法 `class="w-16 h-16"` 继续生效）。

### 4.3 新组件 `AvatarEditor.vue`

复用 `Modal`（已加固遮罩关闭逻辑）+ cropperjs：

1. **选择文件**：`<input type="file" accept="image/jpeg,image/png,image/webp">`；前端即时校验类型与 ≤5MB。
2. **裁剪预览**：`URL.createObjectURL` 加载，初始化 Cropper（aspectRatio 1，圆形蒙层）。
3. **确认上传**：`getCroppedCanvas({ width: 256, height: 256 })` → `toBlob('image/webp', 0.9)`（webp 导出失败回退 png）→ 裸二进制 `POST /api/community/upload?variant=avatar`。
4. **成功**：更新 `store.settings.avatar`（响应式，本人视角立即生效）+ toast「头像已更新」；**失败/断网**：toast 服务端错误消息（沿用统一 request 错误通道）。
5. 上传中禁用按钮，防重复提交。

### 4.4 入口

- `Account.vue` 头像区变为可点击：悬停显示相机角标（lucide 图标），点击打开 `AvatarEditor`。
- `App.vue` 侧边栏头像：优先显示自定义头像（读 `store.settings.avatar`），点击行为不变；不作为编辑入口（spec 指定入口在个人中心）。

### 4.5 展示位接入（调用方传 `:avatar`）

`PostCard`、`CommentItem`、`UserProfileModal`、`ProfilePage`、`LeaderboardBoard`、`ProgressBoard`、`Community`（推荐关注）、`Partners`、`Messages` / `MessageChat`、`CircleDetail`、`TeamDetail`（成员列表，顺带补齐目前缺失的成员头像）。

对应前端类型同步加 `userAvatar?: string`（`src/types` 相关接口、community store 类型、Partner / TeamMember 等）。

细节：`MessageChat` 中自己发出的消息（`fromMe`）头像取当前用户的 `store.settings.avatar`（对方消息取 peer 的 `userAvatar`）。

## 5. 同步更新语义

- **本人视角**：Account 页、侧边栏经 `store.settings.avatar` 响应式更新，上传后立即生效。
- **列表数据**（自己发的帖子/评论内的头像）：来自服务器快照，下次进入页面 / 刷新列表时更新。不引入「按 userId 实时替换」hack（改头像频率极低，不值得增加耦合）。

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 文件格式不符 / 超 5MB | 前端即时 toast，不进入裁剪 |
| 上传中断网 | 统一 request 通道 toast「Failed to fetch」类错误 |
| 服务端限流 / 格式拒绝 | toast 服务端消息 |
| `<img>` 加载失败 | onerror 回退首字母头像 |
| 旧头像 R2 删除失败 | 记日志，不阻塞；下次换头像时随新流程再尝试 |

## 7. 验收清单

- [ ] Account 页可上传 jpg/png/webp，交互式裁剪为 1:1，确认后上传成功
- [ ] 上传后：Account 页、侧边栏头像立即显示新头像
- [ ] 社区帖子、评论、资料卡、排行榜、进步榜、推荐关注、搭子、私信、圈子、小组成员在数据（重新）加载后均显示自定义头像
- [ ] 未配置头像的用户在所有展示位显示首字母渐变兜底
- [ ] 断网 / 超限 / 格式错误有明确 toast 报错
- [ ] 多设备场景：A 设备改头像后，B 设备 `PUT /api/settings` 不会清掉头像
- [ ] 头像上传 30 天后不被孤图清理误删
