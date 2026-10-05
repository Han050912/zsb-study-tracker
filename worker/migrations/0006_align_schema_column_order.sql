-- Align legacy column order with schema.sql after migrations 0001-0005.
-- Preserve every existing value and rowid. Stage both posts and comments before
-- dropping their old tables; the staged comment FK points to staged posts so
-- dropping the old parent cannot cascade-delete the copied comments.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE "__schema_align_community_posts" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'share',  -- 'checkin' | 'share' | 'achievement' | 'longform' | 'question'
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',     -- JSON 数组：['#每日打卡', '#高等数学']
  image_urls TEXT NOT NULL DEFAULT '[]', -- JSON 数组：帖子配图路径（/api/community/images/<id>，最多 9 张）
  is_resolved INTEGER NOT NULL DEFAULT 0, -- 提问帖是否已被楼主标记解决
  accepted_answer_id TEXT,             -- 被采纳最佳答案的评论 ID（采纳即已解答；可取消/改采纳）
  is_featured INTEGER NOT NULL DEFAULT 0, -- 管理员加精标记（精华 Tab）
  is_daily INTEGER NOT NULL DEFAULT 0,    -- 每日一题标记（管理员设置，广场顶部展示最新一题）
  circle_id TEXT,                      -- 所属圈子（NULL = 广场公开帖；圈子帖不进公共广场，保持圈内专属）
  topic_ref TEXT,                     -- 知识点讨论帖标记（'subjectId|chapterName'；非空不进公共广场）
  ref_type TEXT,                       -- 关联源类型：'summary' | 'record' | 'achievement' | 'habit' | 'vocab'
  ref_id TEXT,                         -- 关联源 ID
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_flagged INTEGER NOT NULL DEFAULT 0, -- 软违规待审标记（1=命中软敏感词，仅作者/管理员可见）
  created_at INTEGER NOT NULL,         -- Unix 时间戳（秒）
  updated_at INTEGER NOT NULL
);
INSERT INTO "__schema_align_community_posts" (rowid, "id", "user_id", "type", "content", "tags", "image_urls", "is_resolved", "accepted_answer_id", "is_featured", "is_daily", "circle_id", "topic_ref", "ref_type", "ref_id", "likes_count", "dislikes_count", "comments_count", "is_pinned", "is_hidden", "is_flagged", "created_at", "updated_at")
SELECT rowid, "id", "user_id", "type", "content", "tags", "image_urls", "is_resolved", "accepted_answer_id", "is_featured", "is_daily", "circle_id", "topic_ref", "ref_type", "ref_id", "likes_count", "dislikes_count", "comments_count", "is_pinned", "is_hidden", "is_flagged", "created_at", "updated_at" FROM "community_posts";

CREATE TABLE "__schema_align_community_comments" (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES "__schema_align_community_posts"(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT,
  content TEXT NOT NULL,
  image_urls TEXT NOT NULL DEFAULT '[]', -- JSON 数组：评论配图路径（最多 3 张）
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  is_accepted INTEGER NOT NULL DEFAULT 0, -- 是否被采纳为最佳答案（与 posts.accepted_answer_id 冗余保持一致）
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_flagged INTEGER NOT NULL DEFAULT 0, -- 软违规待审标记（1=命中软敏感词，仅作者/管理员可见）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO "__schema_align_community_comments" (rowid, "id", "post_id", "user_id", "parent_id", "content", "image_urls", "likes_count", "dislikes_count", "is_accepted", "is_hidden", "is_flagged", "created_at", "updated_at")
SELECT rowid, "id", "post_id", "user_id", "parent_id", "content", "image_urls", "likes_count", "dislikes_count", "is_accepted", "is_hidden", "is_flagged", "created_at", "updated_at" FROM "community_comments";

CREATE TABLE "__schema_align_community_messages" (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id),
  to_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  image_urls TEXT,               -- 私信配图（最多 3 张），JSON 数组；NULL/空 = 纯文字
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO "__schema_align_community_messages" (rowid, "id", "from_id", "to_id", "content", "image_urls", "is_read", "created_at")
SELECT rowid, "id", "from_id", "to_id", "content", "image_urls", "is_read", "created_at" FROM "community_messages";

CREATE TABLE "__schema_align_community_notifications" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),  -- 接收者
  type TEXT NOT NULL,                   -- 'like' | 'comment' | 'follow' | 'achievement' | 'system'
  actor_id TEXT,                        -- 触发者
  post_id TEXT,
  comment_id TEXT,
  target_type TEXT,                     -- 点击跳转目标类型：'post' | 'user' | 'message' | 'team' | 'circle' | 'partner'
  target_id TEXT,                       -- 点击跳转目标 id
  content TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO "__schema_align_community_notifications" (rowid, "id", "user_id", "type", "actor_id", "post_id", "comment_id", "target_type", "target_id", "content", "is_read", "created_at")
SELECT rowid, "id", "user_id", "type", "actor_id", "post_id", "comment_id", "target_type", "target_id", "content", "is_read", "created_at" FROM "community_notifications";

CREATE TABLE "__schema_align_partner_study_sessions" (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id),    -- 发起人
  to_id TEXT NOT NULL REFERENCES users(id),      -- 搭子
  status TEXT NOT NULL DEFAULT 'active',         -- 'active' | 'done'
  mode TEXT NOT NULL DEFAULT 'countdown',        -- 计时模式：'countdown' | 'countup'
  focus_minutes INTEGER NOT NULL DEFAULT 25,     -- 专注时长（分钟，双方一致，创建时设定）
  from_state TEXT NOT NULL DEFAULT 'idle',       -- 发起人状态：'idle' | 'focus' | 'done'
  to_state TEXT NOT NULL DEFAULT 'idle',         -- 搭子状态
  from_minutes INTEGER NOT NULL DEFAULT 0,       -- 发起人累计专注分钟
  to_minutes INTEGER NOT NULL DEFAULT 0,         -- 搭子累计专注分钟
  from_online_seconds INTEGER NOT NULL DEFAULT 0, -- 发起人累计在线秒数（墙钟，暂停不计）
  to_online_seconds INTEGER NOT NULL DEFAULT 0,   -- 搭子累计在线秒数
  ended_at INTEGER,                               -- 会话结束时间（status 置 done 时写入）
  from_elapsed_seconds INTEGER NOT NULL DEFAULT 0, -- 发起人当前阶段已消耗秒数
  to_elapsed_seconds INTEGER NOT NULL DEFAULT 0,   -- 搭子当前阶段已消耗秒数
  from_running INTEGER NOT NULL DEFAULT 0,          -- 发起人是否在计时（1=计时中，0=暂停）
  to_running INTEGER NOT NULL DEFAULT 0,            -- 搭子是否在计时
  last_active_at INTEGER NOT NULL DEFAULT 0,        -- 最后活跃时间（任一参与方心跳时刷新，超时未刷新视为僵尸会话并回收）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO "__schema_align_partner_study_sessions" (rowid, "id", "from_id", "to_id", "status", "mode", "focus_minutes", "from_state", "to_state", "from_minutes", "to_minutes", "from_online_seconds", "to_online_seconds", "ended_at", "from_elapsed_seconds", "to_elapsed_seconds", "from_running", "to_running", "last_active_at", "created_at", "updated_at")
SELECT rowid, "id", "from_id", "to_id", "status", "mode", "focus_minutes", "from_state", "to_state", "from_minutes", "to_minutes", "from_online_seconds", "to_online_seconds", "ended_at", "from_elapsed_seconds", "to_elapsed_seconds", "from_running", "to_running", "last_active_at", "created_at", "updated_at" FROM "partner_study_sessions";

CREATE TABLE "__schema_align_pomodoro_records" (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  time INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  description TEXT DEFAULT '',
  source TEXT DEFAULT 'solo',
  partner_name TEXT,
  completed INTEGER NOT NULL DEFAULT 1 CHECK (completed IN (0, 1)), -- 是否完成；旧记录沿用完成语义
  updated_at INTEGER NOT NULL DEFAULT 0, -- 客户端编辑时刻(ms)，LWW 比较键
  server_seq INTEGER NOT NULL DEFAULT 0, -- 服务端单调序号，拉取游标
  PRIMARY KEY (user_id, id)
);
INSERT INTO "__schema_align_pomodoro_records" (rowid, "id", "user_id", "date", "time", "minutes", "description", "source", "partner_name", "completed", "updated_at", "server_seq")
SELECT rowid, "id", "user_id", "date", "time", "minutes", "description", "source", "partner_name", "completed", "updated_at", "server_seq" FROM "pomodoro_records";

DROP TABLE "community_comments";
DROP TABLE "community_posts";
DROP TABLE "community_messages";
DROP TABLE "community_notifications";
DROP TABLE "partner_study_sessions";
DROP TABLE "pomodoro_records";

ALTER TABLE "__schema_align_community_posts" RENAME TO "community_posts";
ALTER TABLE "__schema_align_community_comments" RENAME TO "community_comments";
ALTER TABLE "__schema_align_community_messages" RENAME TO "community_messages";
ALTER TABLE "__schema_align_community_notifications" RENAME TO "community_notifications";
ALTER TABLE "__schema_align_partner_study_sessions" RENAME TO "partner_study_sessions";
ALTER TABLE "__schema_align_pomodoro_records" RENAME TO "pomodoro_records";

CREATE INDEX idx_comments_parent_id ON community_comments(parent_id);
CREATE INDEX idx_comments_post_id ON community_comments(post_id);
CREATE INDEX idx_messages_pair ON community_messages(from_id, to_id, created_at);
CREATE INDEX idx_messages_to ON community_messages(to_id, is_read);
CREATE INDEX idx_notify_unread ON community_notifications(user_id, is_read);
CREATE INDEX idx_notify_user ON community_notifications(user_id, created_at);
CREATE INDEX idx_posts_circle ON community_posts(circle_id, created_at);
CREATE INDEX idx_posts_created_at ON community_posts(created_at);
CREATE INDEX idx_posts_featured ON community_posts(is_featured, created_at);
CREATE INDEX idx_posts_type ON community_posts(type);
CREATE INDEX idx_posts_user_id ON community_posts(user_id);
CREATE INDEX idx_pss_from ON partner_study_sessions(from_id, status);
CREATE INDEX idx_pss_to ON partner_study_sessions(to_id, status);

PRAGMA defer_foreign_keys = OFF;
