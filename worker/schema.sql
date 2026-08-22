-- 已建库升级：notes 表新增 type 列（PDF 笔记），执行一次：
--   ALTER TABLE notes ADD COLUMN type TEXT;
-- 已建库升级：pdf_chunks 分片表（替代 R2），执行一次：
--   CREATE TABLE IF NOT EXISTS pdf_chunks ( user_id TEXT NOT NULL REFERENCES users(id), pdf_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (user_id, pdf_id, chunk_index) );
-- 已建库升级：users 表新增 role 列（管理员体系），执行一次：
--   ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
-- 将指定用户设为管理员：UPDATE users SET role = 'admin' WHERE username = '你的用户名';
-- 已建库升级：社区增强 P0（图片/提问帖/举报/审核留痕），执行一次：
--   ALTER TABLE community_posts ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]';
--   ALTER TABLE community_posts ADD COLUMN is_resolved INTEGER NOT NULL DEFAULT 0;
--   CREATE TABLE IF NOT EXISTS community_uploads ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL DEFAULT '', r2_key TEXT NOT NULL, url TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL, created_at INTEGER NOT NULL );
--   CREATE INDEX IF NOT EXISTS idx_uploads_user ON community_uploads(user_id);
--   CREATE TABLE IF NOT EXISTS community_reports ( id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL );
--   CREATE INDEX IF NOT EXISTS idx_reports_status ON community_reports(status, created_at);
--   CREATE TABLE IF NOT EXISTS community_moderation_log ( id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, report_id TEXT, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL );
--   CREATE INDEX IF NOT EXISTS idx_modlog_created ON community_moderation_log(created_at);

-- ========== 组队挑战（P2-2）==========
-- 学习小组：多人组队完成打卡/刷题目标，达标全员获团队徽章
CREATE TABLE IF NOT EXISTS study_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- 1-30 字
  description TEXT NOT NULL DEFAULT '',  -- 0-200 字
  creator_id TEXT NOT NULL REFERENCES users(id),
  member_count INTEGER NOT NULL DEFAULT 0,
  max_members INTEGER NOT NULL DEFAULT 10, -- 最大成员数（默认 10 人）
  is_public INTEGER NOT NULL DEFAULT 1,    -- 1 公开可见可加入；0 仅邀请
  invite_code TEXT,                        -- 邀请码（私密组有值，公开组 NULL）
  invite_code_expires_at INTEGER,          -- 邀请码过期时间（Unix 秒）
  created_at INTEGER NOT NULL
);

-- 小组成员：role 区分队长；active_challenges 冗余当前活跃挑战数（用于列表展示）
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES study_teams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',   -- 'leader' | 'member'
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tmembers_user ON team_members(user_id);

-- 入组申请（只存待审核）：主键保证一人对一组仅一条待审申请
CREATE TABLE IF NOT EXISTS team_join_requests (
  team_id TEXT NOT NULL REFERENCES study_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

-- 组队挑战：目标类型支持打卡天数/学习时长/刷题数
CREATE TABLE IF NOT EXISTS team_challenges (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES study_teams(id),
  type TEXT NOT NULL,                    -- 'streak' | 'minutes' | 'problems'
  target INTEGER NOT NULL,               -- 目标值（天数/分钟数/题数）
  duration_days INTEGER NOT NULL,        -- 挑战持续天数
  start_date TEXT NOT NULL,              -- 'YYYY-MM-DD'
  end_date TEXT NOT NULL,                -- 'YYYY-MM-DD'（含当天）
  completed_count INTEGER NOT NULL DEFAULT 0, -- 已达标成员数
  is_completed INTEGER NOT NULL DEFAULT 0,    -- 全员达标标记
  is_cancelled INTEGER NOT NULL DEFAULT 0,    -- 取消标记（1=已取消，暂停同步）
  remaining_days INTEGER,                     -- 取消时记录的剩余天数（恢复时顺延用）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tchallenges_team ON team_challenges(team_id, created_at);

-- 挑战成员进度：记录每个成员的完成情况
CREATE TABLE IF NOT EXISTS team_challenge_progress (
  challenge_id TEXT NOT NULL REFERENCES team_challenges(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  current_value INTEGER NOT NULL DEFAULT 0, -- 当前进度值
  is_completed INTEGER NOT NULL DEFAULT 0,  -- 是否已达标
  completed_at INTEGER,                     -- 达标时间
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tprogress_user ON team_challenge_progress(user_id);
-- 已建库升级：社区增强 P1（最佳答案/精华帖/评论图片），执行一次：
--   ALTER TABLE community_posts ADD COLUMN accepted_answer_id TEXT;
--   ALTER TABLE community_posts ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE community_comments ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]';
--   ALTER TABLE community_comments ADD COLUMN is_accepted INTEGER NOT NULL DEFAULT 0;
--   CREATE INDEX IF NOT EXISTS idx_posts_featured ON community_posts(is_featured, created_at);
-- 已建库升级：社区增强 P1 第二批（专家认证/徽章系统），执行一次：
--   ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE users ADD COLUMN expertise TEXT NOT NULL DEFAULT '';
--   CREATE TABLE IF NOT EXISTS user_badges ( user_id TEXT NOT NULL REFERENCES users(id), badge_key TEXT NOT NULL, awarded_at INTEGER NOT NULL, PRIMARY KEY (user_id, badge_key) );
-- 已建库升级：社区增强 P1 第三批（好友关注/每日一题），执行一次：
--   CREATE TABLE IF NOT EXISTS user_follows ( follower_id TEXT NOT NULL REFERENCES users(id), followee_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (follower_id, followee_id) );
--   CREATE INDEX IF NOT EXISTS idx_follows_followee ON user_follows(followee_id);
--   ALTER TABLE community_posts ADD COLUMN is_daily INTEGER NOT NULL DEFAULT 0;
-- 已建库升级：社区增强 P1 第四批（话题圈子），执行一次：
--   CREATE TABLE IF NOT EXISTS community_circles ( id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', creator_id TEXT NOT NULL REFERENCES users(id), is_public INTEGER NOT NULL DEFAULT 1, member_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL );
--   CREATE TABLE IF NOT EXISTS circle_members ( circle_id TEXT NOT NULL REFERENCES community_circles(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, PRIMARY KEY (circle_id, user_id) );
--   CREATE INDEX IF NOT EXISTS idx_cmembers_user ON circle_members(user_id);
--   ALTER TABLE community_posts ADD COLUMN circle_id TEXT;
--   CREATE INDEX IF NOT EXISTS idx_posts_circle ON community_posts(circle_id, created_at);
-- 已建库升级：社区增强 P2（私信），执行一次：
--   CREATE TABLE IF NOT EXISTS community_messages ( id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES users(id), to_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL );
--   CREATE INDEX IF NOT EXISTS idx_messages_to ON community_messages(to_id, is_read);
--   CREATE INDEX IF NOT EXISTS idx_messages_pair ON community_messages(from_id, to_id, created_at);
-- 已建库升级：社区增强 P2（知识点讨论区），执行一次：
--   ALTER TABLE community_posts ADD COLUMN topic_ref TEXT;
--   ALTER TABLE community_posts ADD COLUMN ref_type TEXT;
--   ALTER TABLE community_posts ADD COLUMN ref_id TEXT;
-- 已建库升级：组队挑战（P2-2），执行一次：
--   CREATE TABLE IF NOT EXISTS study_teams ( id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', creator_id TEXT NOT NULL REFERENCES users(id), member_count INTEGER NOT NULL DEFAULT 0, max_members INTEGER NOT NULL DEFAULT 10, is_public INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL );
--   CREATE TABLE IF NOT EXISTS team_members ( team_id TEXT NOT NULL REFERENCES study_teams(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id) );
--   CREATE INDEX IF NOT EXISTS idx_tmembers_user ON team_members(user_id);
--   CREATE TABLE IF NOT EXISTS team_challenges ( id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES study_teams(id), type TEXT NOT NULL, target INTEGER NOT NULL, duration_days INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, completed_count INTEGER NOT NULL DEFAULT 0, is_completed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL );
--   CREATE INDEX IF NOT EXISTS idx_tchallenges_team ON team_challenges(team_id, created_at);
--   CREATE TABLE IF NOT EXISTS team_challenge_progress ( challenge_id TEXT NOT NULL REFERENCES team_challenges(id), user_id TEXT NOT NULL REFERENCES users(id), current_value INTEGER NOT NULL DEFAULT 0, is_completed INTEGER NOT NULL DEFAULT 0, completed_at INTEGER, PRIMARY KEY (challenge_id, user_id) );
--   CREATE INDEX IF NOT EXISTS idx_tprogress_user ON team_challenge_progress(user_id);
-- 已建库升级：组队挑战管理（P2-2 补充：取消/恢复/编辑/删除），执行一次：
--   ALTER TABLE team_challenges ADD COLUMN is_cancelled INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE team_challenges ADD COLUMN remaining_days INTEGER;
-- 已建库升级：待办新增开始 / 最晚截止时间与提醒去重标记，执行一次：
--   ALTER TABLE todos ADD COLUMN start_at INTEGER;
--   ALTER TABLE todos ADD COLUMN due_at INTEGER;
--   ALTER TABLE todos ADD COLUMN start_notified_at INTEGER;
--   ALTER TABLE todos ADD COLUMN due_notified_at INTEGER;
-- 已建库升级：社区 P1 进步榜（学习进度对比），执行一次：
--   ALTER TABLE user_settings ADD COLUMN join_progress_board INTEGER NOT NULL DEFAULT 0;
-- 已建库升级：热门话题运营位（P1），执行一次：
--   CREATE TABLE IF NOT EXISTS community_hot_topics ( id TEXT PRIMARY KEY, text TEXT NOT NULL, tag TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL );
-- 已建库升级：社区踩投票（P1），执行一次：
--   ALTER TABLE community_posts ADD COLUMN dislikes_count INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE community_comments ADD COLUMN dislikes_count INTEGER NOT NULL DEFAULT 0;
--   CREATE TABLE IF NOT EXISTS community_dislikes ( user_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, target_type, target_id) );
-- 已建库升级：主页可见性设置（P1），执行一次：
--   ALTER TABLE user_settings ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'login';
-- 已建库升级：社区图片缩略图（P1），执行一次：
--   ALTER TABLE community_uploads ADD COLUMN thumb_r2_key TEXT;
-- 已建库升级：学习搭子（P2-7），执行一次：
--   CREATE TABLE IF NOT EXISTS study_partners ( id TEXT PRIMARY KEY, pair_key TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(pair_key) );
--   CREATE INDEX IF NOT EXISTS idx_partners_to ON study_partners(to_id, status);
--   CREATE INDEX IF NOT EXISTS idx_partners_from ON study_partners(from_id, status);
-- 已建库升级：意见反馈（P2-8），执行一次：
--   CREATE TABLE IF NOT EXISTS feedback ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, content TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', image_urls TEXT NOT NULL DEFAULT '[]', github_issue_url TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL );
--   CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
--   CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at);
-- 已建库升级：用户自定义头像（P0），执行一次：
--   ALTER TABLE user_settings ADD COLUMN avatar TEXT;
-- 已建库升级：内容软违规标记（P3），执行一次：
--   ALTER TABLE community_posts ADD COLUMN is_flagged INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE community_comments ADD COLUMN is_flagged INTEGER NOT NULL DEFAULT 0;
-- 已建库升级：私密组邀请码 + 入组申请（#8），执行一次：
--   ALTER TABLE study_teams ADD COLUMN invite_code TEXT;
--   ALTER TABLE study_teams ADD COLUMN invite_code_expires_at INTEGER;
--   CREATE TABLE IF NOT EXISTS team_join_requests ( team_id TEXT NOT NULL REFERENCES study_teams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id) );
-- 新库直接执行本文件即可（所有建表语句已含最新列）。

-- ========== 用户认证 ==========
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  verified INTEGER NOT NULL DEFAULT 0, -- 专家认证标记（蓝 V），管理员后台授予
  expertise TEXT NOT NULL DEFAULT '',  -- 专长领域（如 "高等数学,英语"）
  created_at INTEGER NOT NULL
);

-- ========== 用户设置（一行一用户） ==========
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  user_name TEXT,               -- 显示昵称（注册时初始化为登录用户名；NULL = 未设置，展示端兜底 users.username）
  daily_goal_minutes INTEGER DEFAULT 240,
  word_goal INTEGER DEFAULT 50,
  problem_goal INTEGER DEFAULT 30,
  exam_date TEXT DEFAULT '',
  theme TEXT DEFAULT 'light',
  reminder_enabled INTEGER DEFAULT 0,
  reminder_time TEXT DEFAULT '08:00',
  maimemo_token TEXT,           -- 墨墨 Token（用户自行获取填入）
  netease_uid TEXT,             -- 网易云 UID（用户手动填写）
  onboarded INTEGER DEFAULT 0,  -- 是否完成新手引导
  join_progress_board INTEGER NOT NULL DEFAULT 0,  -- 参与学习进步榜（本周时长/本月刷题榜；默认不参与）
  profile_visibility TEXT NOT NULL DEFAULT 'login',  -- 主页可见性：'public'所有人 / 'login'登录(默认) / 'private'仅自己
  avatar TEXT                                   -- 自定义头像相对 URL（/api/avatar/<file>；NULL = 首字母兜底）
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
  start_at INTEGER,                -- 计划开始时间（时间戳），到点提醒任务开始
  due_at INTEGER,                  -- 最晚截止时间（时间戳），到点未完成则提醒
  start_notified_at INTEGER,       -- 开始提醒已发出时间（去重）
  due_notified_at INTEGER,         -- 截止提醒已发出时间（去重）
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
  created_at INTEGER NOT NULL,         -- Unix 时间戳（秒）
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON community_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON community_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_type ON community_posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_featured ON community_posts(is_featured, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_circle ON community_posts(circle_id, created_at);

-- 评论表：parent_id NULL 为一级评论，非 NULL 为二级回复（最多二级）
CREATE TABLE IF NOT EXISTS community_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT,
  content TEXT NOT NULL,
  image_urls TEXT NOT NULL DEFAULT '[]', -- JSON 数组：评论配图路径（最多 3 张）
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  is_accepted INTEGER NOT NULL DEFAULT 0, -- 是否被采纳为最佳答案（与 posts.accepted_answer_id 冗余保持一致）
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
  type TEXT NOT NULL,                   -- 'like' | 'comment' | 'follow' | 'achievement' | 'system'
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

-- ========== 社区增强：图片上传 / 举报 / 审核留痕 ==========
-- 图片上传记录：二进制存 R2（绑定 IMAGES），本表仅存元数据；读取走 /api/community/images/:id 代理路由
CREATE TABLE IF NOT EXISTS community_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  url TEXT NOT NULL,                -- 读取路径 /api/community/images/<id>
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  thumb_r2_key TEXT,               -- 缩略图 R2 key（前端 canvas 压缩后上传）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON community_uploads(user_id);

-- 内容举报：举报人匿名（列表仅管理员可见）；status: 'pending' | 'resolved' | 'rejected'
CREATE TABLE IF NOT EXISTS community_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,        -- 'post' | 'comment' | 'message'
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,             -- 预设原因：广告 / 人身攻击 / 不相关内容 / 其他
  detail TEXT NOT NULL DEFAULT '',  -- 补充说明（选填）
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON community_reports(status, created_at);

-- 好友关注关系：复合主键保证仅关注一次；关注流 = 筛选关注作者的帖子
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id TEXT NOT NULL REFERENCES users(id),
  followee_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON user_follows(followee_id);

-- 话题圈子：圈内专属讨论（圈子帖 circle_id 非空，不进公共广场）
CREATE TABLE IF NOT EXISTS community_circles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- 1-30 字
  description TEXT NOT NULL DEFAULT '',  -- 0-200 字
  creator_id TEXT NOT NULL REFERENCES users(id),
  is_public INTEGER NOT NULL DEFAULT 1,  -- 1 公开直接加入；0 审核加入（pending 需圈主批准）
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 圈子成员：role 区分圈主；status=pending 表示审核圈待批准（不计入 member_count）
CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL REFERENCES community_circles(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'pending'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cmembers_user ON circle_members(user_id);

-- 私信：一对一消息（单向模式，无需互关；发送即通知对方，举报复用 community_reports target_type='message'）
CREATE TABLE IF NOT EXISTS community_messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id),
  to_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_to ON community_messages(to_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON community_messages(from_id, to_id, created_at);

-- 用户徽章：服务端事件驱动发放（发帖/提问/打卡里程碑/获赞/被采纳/上传），主键去重保证仅发放一次
CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_key TEXT NOT NULL,          -- 见 worker/src/api/badges.ts BADGE_DEFS
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_key)
);

-- 审核操作日志：所有治理动作留痕（action: 'hide' | 'delete' | 'reject' 等）
CREATE TABLE IF NOT EXISTS community_moderation_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,        -- 'post' | 'comment' | 'report'
  target_id TEXT NOT NULL,
  report_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modlog_created ON community_moderation_log(created_at);

-- 热门话题运营位（P1）：只存管理员干预名单（置顶/屏蔽），自动统计部分不落表
CREATE TABLE IF NOT EXISTS community_hot_topics (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,                     -- 展示文案（置顶条目可自定义，≤20 字）
  tag TEXT NOT NULL,                      -- 关联话题 tag（含 # 前缀，与帖子 tags 同格式）
  action TEXT NOT NULL,                   -- 'pin'（强制前置展示） | 'block'（从自动统计剔除）
  created_at INTEGER NOT NULL
);

-- 踩投票记录：主键 (user_id, target_type, target_id) 去重，保证一人一内容至多一踩
CREATE TABLE IF NOT EXISTS community_dislikes (
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,   -- 'post' | 'comment'
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);

-- 学习搭子关系（P2-7）：pair_key = 两用户 id 排序后拼接，UNIQUE 保证一对用户恒一行
CREATE TABLE IF NOT EXISTS study_partners (
  id TEXT PRIMARY KEY,
  pair_key TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pair_key)
);
CREATE INDEX IF NOT EXISTS idx_partners_to ON study_partners(to_id, status);
CREATE INDEX IF NOT EXISTS idx_partners_from ON study_partners(from_id, status);

-- ========== 意见反馈 ==========
-- 反馈提交后先落 D1（站内管理员后台查看）；github_issue_url 为异步回写的 GitHub issue 链接（尽力而为，可为空）
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                    -- 'feature' | 'bug' | 'experience' | 'other'
  content TEXT NOT NULL,                 -- 文字描述（1-2000 字）
  contact TEXT NOT NULL DEFAULT '',      -- 联系方式（可选，0-100 字）
  image_urls TEXT NOT NULL DEFAULT '[]', -- 截图路径数组（JSON，最多 3 张）
  github_issue_url TEXT,                 -- GitHub issue 链接（创建成功后回写，可空）
  status TEXT NOT NULL DEFAULT 'pending',-- 'pending' | 'resolved'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at);
