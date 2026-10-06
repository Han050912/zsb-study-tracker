-- 保留旧版仅有日汇总的数据；已有明细对应的部分转由唯一明细派生。
ALTER TABLE pomodoro_daily ADD COLUMN legacy_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pomodoro_daily ADD COLUMN legacy_minutes REAL NOT NULL DEFAULT 0;
ALTER TABLE pomodoro_daily ADD COLUMN legacy_interruptions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pomodoro_daily ADD COLUMN legacy_updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE pomodoro_daily SET
  legacy_count = MAX(0, COALESCE(count, 0) - (SELECT COUNT(*) FROM pomodoro_records r WHERE r.user_id = pomodoro_daily.user_id AND r.date = pomodoro_daily.date AND r.completed = 1)),
  legacy_minutes = MAX(0, COALESCE(minutes, 0) - (SELECT COALESCE(SUM(r.minutes), 0) FROM pomodoro_records r WHERE r.user_id = pomodoro_daily.user_id AND r.date = pomodoro_daily.date)),
  legacy_interruptions = MAX(0, COALESCE(interruptions, 0) - (SELECT COUNT(*) FROM pomodoro_interruptions i WHERE i.user_id = pomodoro_daily.user_id AND i.date = pomodoro_daily.date)),
  legacy_updated_at = updated_at;
ALTER TABLE pomodoro_interruptions ADD COLUMN event_id TEXT;
-- 历史行没有事件身份：相同日期/时间/原因也可能是不同事件，逐行保留并分配短ID。
UPDATE pomodoro_interruptions SET event_id = 'legacy:' || id;
CREATE UNIQUE INDEX idx_pomodoro_interruption_event ON pomodoro_interruptions(user_id, event_id);
INSERT OR IGNORE INTO pomodoro_daily (user_id, date)
SELECT user_id, date FROM pomodoro_records UNION SELECT user_id, date FROM pomodoro_interruptions;
UPDATE pomodoro_daily SET
  count = legacy_count + (SELECT COUNT(*) FROM pomodoro_records r WHERE r.user_id = pomodoro_daily.user_id AND r.date = pomodoro_daily.date AND r.completed = 1),
  minutes = legacy_minutes + (SELECT COALESCE(SUM(r.minutes), 0) FROM pomodoro_records r WHERE r.user_id = pomodoro_daily.user_id AND r.date = pomodoro_daily.date),
  interruptions = legacy_interruptions + (SELECT COUNT(*) FROM pomodoro_interruptions i WHERE i.user_id = pomodoro_daily.user_id AND i.date = pomodoro_daily.date),
  updated_at = MAX(updated_at,
    COALESCE((SELECT MAX(r.updated_at) FROM pomodoro_records r WHERE r.user_id = pomodoro_daily.user_id AND r.date = pomodoro_daily.date), 0),
    COALESCE((SELECT MAX(i.updated_at) FROM pomodoro_interruptions i WHERE i.user_id = pomodoro_daily.user_id AND i.date = pomodoro_daily.date), 0)) + 1;
-- 前端按 updated_at 合并整日事件列表；同一日期所有事件使用同一新时间戳。
UPDATE pomodoro_interruptions SET updated_at = (
  SELECT d.updated_at FROM pomodoro_daily d WHERE d.user_id = pomodoro_interruptions.user_id AND d.date = pomodoro_interruptions.date
);
-- 已登录设备同样能发现修复后的汇总/事件身份，迁移不沿用已经被消费的旧游标。
INSERT INTO sync_domain_versions (user_id, domain, version, updated_at)
SELECT d.user_id, 'pomodoro', MAX(COALESCE(v.version, 0),
  COALESCE((SELECT MAX(p.server_seq) FROM pomodoro_daily p WHERE p.user_id = d.user_id), 0),
  COALESCE((SELECT MAX(r.server_seq) FROM pomodoro_records r WHERE r.user_id = d.user_id), 0),
  COALESCE((SELECT MAX(i.server_seq) FROM pomodoro_interruptions i WHERE i.user_id = d.user_id), 0),
  COALESCE((SELECT MAX(t.seq) FROM sync_deletions t WHERE t.user_id = d.user_id AND t.domain = 'pomodoro'), 0)) + 1,
  CAST(strftime('%s', 'now') AS INTEGER)
FROM (SELECT DISTINCT user_id FROM pomodoro_daily) d
LEFT JOIN sync_domain_versions v ON v.user_id = d.user_id AND v.domain = 'pomodoro' WHERE 1
ON CONFLICT(user_id, domain) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;
UPDATE pomodoro_daily SET server_seq = (SELECT version FROM sync_domain_versions v WHERE v.user_id = pomodoro_daily.user_id AND v.domain = 'pomodoro');
UPDATE pomodoro_interruptions SET server_seq = (SELECT version FROM sync_domain_versions v WHERE v.user_id = pomodoro_interruptions.user_id AND v.domain = 'pomodoro');
INSERT INTO sync_domain_versions (user_id, domain, version, updated_at)
SELECT DISTINCT user_id, '__push__', 1, CAST(strftime('%s', 'now') AS INTEGER) FROM pomodoro_daily WHERE 1
ON CONFLICT(user_id, domain) DO UPDATE SET version = sync_domain_versions.version + 1, updated_at = excluded.updated_at;
