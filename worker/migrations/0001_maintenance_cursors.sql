-- 升级既有数据库时执行；幂等，不改动用户数据。
-- 在部署使用持久化孤图扫描游标的 Worker 之前应用。
CREATE TABLE IF NOT EXISTS maintenance_cursors (
  name TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  row_id TEXT NOT NULL
);
