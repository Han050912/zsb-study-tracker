-- 存量 JWT 缺少版本 claim，按版本 0 兼容；首次改密递增后立即失效。
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

-- 保留一个待审记录，其余重复记录留在审计历史，避免唯一索引创建失败。
UPDATE community_reports SET status = 'rejected'
WHERE status = 'pending' AND id NOT IN (
  SELECT MIN(id) FROM community_reports WHERE status = 'pending'
  GROUP BY reporter_id, target_type, target_id
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_pending_reporter
  ON community_reports(reporter_id, target_type, target_id) WHERE status = 'pending';
