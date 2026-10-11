-- 学习归属是可选元数据：不复制番茄时长，也不改变已有任务或计时记录。
ALTER TABLE todos ADD COLUMN subject_id TEXT;
ALTER TABLE todos ADD COLUMN chapter_id TEXT;
ALTER TABLE pomodoro_records ADD COLUMN todo_id TEXT;
ALTER TABLE pomodoro_records ADD COLUMN subject_id TEXT;
ALTER TABLE pomodoro_records ADD COLUMN chapter_id TEXT;
