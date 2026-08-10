-- 已建库升级：notes 表新增 type 列（PDF 笔记），执行一次：
--   ALTER TABLE notes ADD COLUMN type TEXT;
-- 已建库升级：pdf_chunks 分片表（替代 R2），执行一次：
--   CREATE TABLE IF NOT EXISTS pdf_chunks ( user_id TEXT NOT NULL REFERENCES users(id), pdf_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (user_id, pdf_id, chunk_index) );
-- 已建库升级：users 表新增 role 列（管理员体系），执行一次：
--   ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
-- 将指定用户设为管理员：UPDATE users SET role = 'admin' WHERE username = '你的用户名';
-- 新库直接执行本文件即可（所有建表语句已含最新列）。

-- ========== 用户认证 ==========
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  created_at INTEGER NOT NULL
);

-- ========== 用户设置（一行一用户） ==========
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  user_name TEXT DEFAULT '升本人',
  daily_goal_minutes INTEGER DEFAULT 240,
  word_goal INTEGER DEFAULT 50,
  problem_goal INTEGER DEFAULT 30,
  exam_date TEXT DEFAULT '',
  theme TEXT DEFAULT 'light',
  reminder_enabled INTEGER DEFAULT 0,
  reminder_time TEXT DEFAULT '08:00',
  maimemo_token TEXT,           -- 墨墨 Token（用户自行获取填入）
  netease_uid TEXT,             -- 网易云 UID（用户手动填写）
  onboarded INTEGER DEFAULT 0   -- 是否完成新手引导
);

-- ========== 科目/章节/知识点（三层级联） ==========
-- 多租户约束：前端自有 id（如内置科目 'math'）仅按用户唯一，故采用 (user_id, id) 复合主键；
-- 级联删除由 Worker 代码完成（subjects.ts），不依赖外键。
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  weight INTEGER DEFAULT 0,
  builtin INTEGER DEFAULT 0,    -- 0=用户自定义, 1=系统预设（如语文/数学/英语/计算机）
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT NOT NULL,             -- Worker 生成的 uid
  user_id TEXT NOT NULL REFERENCES users(id),
  chapter_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mastery INTEGER DEFAULT 0,    -- 0-100 掌握程度
  importance TEXT DEFAULT 'normal',
  PRIMARY KEY (user_id, id)
);

-- ========== 学习记录 ==========
CREATE TABLE IF NOT EXISTS study_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  date TEXT NOT NULL,           -- 'YYYY-MM-DD'
  minutes INTEGER NOT NULL,
  chapter_id TEXT,
  topic TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- ========== 刷题记录 ==========
CREATE TABLE IF NOT EXISTS problem_sessions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  types TEXT NOT NULL,          -- JSON 字符串：题型分布
  PRIMARY KEY (user_id, id)
);

-- ========== 错题本 ==========
CREATE TABLE IF NOT EXISTS error_questions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  date TEXT NOT NULL,
  chapter TEXT,
  type TEXT NOT NULL,           -- 题型（选择题/填空题/简答题等）
  content TEXT NOT NULL,        -- 题目内容
  answer TEXT,                  -- 正确答案
  image TEXT,                   -- base64 dataURL（题目配图）
  review_count INTEGER DEFAULT 0,
  mastered INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- ========== 真题/套卷 ==========
CREATE TABLE IF NOT EXISTS exam_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  score INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  parts TEXT,                   -- JSON：各部分得分明细
  PRIMARY KEY (user_id, id)
);

-- ========== Markdown 笔记 ==========
CREATE TABLE IF NOT EXISTS notes (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,        -- Markdown 正文 / PDF 的 D1 引用（'d1:<id>'，原文分片存 pdf_chunks）
  tags TEXT,                    -- JSON 数组：标签列表
  type TEXT,                    -- NULL 为 Markdown 笔记；'pdf' 为 PDF 原文笔记
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- ========== 背单词打卡 ==========
CREATE TABLE IF NOT EXISTS vocab_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  new_words INTEGER NOT NULL,
  review_words INTEGER NOT NULL,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

-- ========== 英语专项：阅读 ==========
CREATE TABLE IF NOT EXISTS reading_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  wpm INTEGER NOT NULL,        -- 阅读速度（词/分钟）
  accuracy REAL NOT NULL,      -- 正确率（0-1）
  PRIMARY KEY (user_id, id)
);

-- ========== 英语专项：听力 ==========
CREATE TABLE IF NOT EXISTS listening_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  material TEXT NOT NULL,      -- 听力材料名称
  mode TEXT NOT NULL,          -- 精听/泛听/听写
  PRIMARY KEY (user_id, id)
);

-- ========== 英语专项：作文模板 ==========
CREATE TABLE IF NOT EXISTS essay_templates (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  category TEXT,
  PRIMARY KEY (user_id, id)
);

-- ========== 每日总结 ==========
CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  mood TEXT NOT NULL,           -- 心情 emoji/文字
  harvest TEXT NOT NULL,        -- 今日收获
  improve TEXT NOT NULL,        -- 不足之处
  plan TEXT NOT NULL,           -- 明日计划
  PRIMARY KEY (user_id, date)
);

-- ========== 习惯追踪 ==========
CREATE TABLE IF NOT EXISTS habits (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'checkbox' | 'minutes' | 'count'
  target INTEGER,
  bad INTEGER DEFAULT 0,        -- 0=好习惯, 1=坏习惯
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS habit_records (
  user_id TEXT NOT NULL REFERENCES users(id),
  habit_id TEXT NOT NULL,
  date TEXT NOT NULL,
  value TEXT,
  checkin INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, habit_id, date)
);

-- ========== 学习资料库 ==========
CREATE TABLE IF NOT EXISTS materials (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'book' | 'video' | 'link' | 'doc'
  subject_id TEXT,
  priority TEXT DEFAULT '中',
  url TEXT,
  file_name TEXT,
  author TEXT,
  total_pages INTEGER,
  read_pages INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- ========== 游戏化 ==========
CREATE TABLE IF NOT EXISTS gamification (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  points INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,     -- 连续打卡天数
  last_checkin TEXT DEFAULT '',
  achievements TEXT DEFAULT '[]' -- JSON 数组
);

CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT
);

-- ========== 番茄钟统计 ==========
CREATE TABLE IF NOT EXISTS pomodoro_daily (
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  minutes INTEGER DEFAULT 0,
  interruptions INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS pomodoro_interruptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pomodoro_partial_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  time INTEGER NOT NULL
);

-- ========== 待办事项 ==========
CREATE TABLE IF NOT EXISTS todos (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  "order" INTEGER DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, id)
);

-- ========== 自定义引言 ==========
CREATE TABLE IF NOT EXISTS default_quotes (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  quotes TEXT NOT NULL           -- JSON 数组
);

-- ========== 社区广场 ==========
-- 帖子表：likes_count/comments_count 冗余聚合，避免列表查询 JOIN 计数
CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'share',  -- 'checkin' | 'share' | 'achievement' | 'longform'
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',     -- JSON 数组：['#每日打卡', '#高等数学']
  ref_type TEXT,                       -- 关联源类型：'summary' | 'record' | 'achievement' | 'habit' | 'vocab'
  ref_id TEXT,                         -- 关联源 ID
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,         -- Unix 时间戳（秒）
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON community_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON community_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_type ON community_posts(type);

-- 评论表：parent_id NULL 为一级评论，非 NULL 为二级回复（最多二级）
CREATE TABLE IF NOT EXISTS community_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT,
  content TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON community_comments(parent_id);

-- 点赞表：复合主键保证同一用户对同一目标只能点赞一次
CREATE TABLE IF NOT EXISTS community_likes (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,           -- 'post' | 'comment'
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_target ON community_likes(target_type, target_id);

-- 通知表
CREATE TABLE IF NOT EXISTS community_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),  -- 接收者
  type TEXT NOT NULL,                   -- 'like' | 'comment' | 'follow' | 'achievement'
  actor_id TEXT,                        -- 触发者
  post_id TEXT,
  comment_id TEXT,
  content TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notify_user ON community_notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notify_unread ON community_notifications(user_id, is_read);

-- ========== PDF 原文分片存储（D1，替代 R2） ==========
-- 单行上限约 100KB，按 95KB 分片，30MB PDF 约拆 324 片
CREATE TABLE IF NOT EXISTS pdf_chunks (
  user_id TEXT NOT NULL REFERENCES users(id),
  pdf_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (user_id, pdf_id, chunk_index)
);
