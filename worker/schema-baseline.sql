-- 仅在新空库已成功执行当前 schema.sql 后登记。已有库禁止使用此整批基线。
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_maintenance_cursors.sql'),
  ('0002_r2_cleanup_jobs.sql'),
  ('0003_study_reward_daily_usage.sql'),
  ('0004_repair_team_champion_awards.sql'),
  ('0005_pomodoro_completed.sql'),
  ('0006_align_schema_column_order.sql'),
  ('0007_profile_learning_privacy.sql'),
  ('0008_material_favorites.sql'),
  ('0009_error_review_schedule.sql'),
  ('0010_auth_sessions_reports.sql'),
  ('0011_data_integrity.sql');
