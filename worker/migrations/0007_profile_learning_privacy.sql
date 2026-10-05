-- 既有账号默认保护学习数据；社交主页、帖子和关注关系仍按原有可见性设置。
ALTER TABLE user_settings ADD COLUMN share_learning_stats INTEGER NOT NULL DEFAULT 0;
