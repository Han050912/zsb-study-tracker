-- Repair the old split transaction: a challenge could be marked completed before
-- its badge, notice, or broadcast was committed. Only participants recorded as
-- completed in an uncancelled, completed challenge qualify (not later joiners).
-- Natural keys and legacy content/ref checks match badgeAwardStatements.
WITH recipients AS (
  SELECT DISTINCT p.user_id FROM team_challenge_progress p
  JOIN team_challenges c ON c.id = p.challenge_id
  WHERE c.is_completed = 1 AND c.is_cancelled = 0 AND p.is_completed = 1
)
INSERT OR IGNORE INTO user_badges (user_id, badge_key, awarded_at)
SELECT user_id, 'team_champion', CAST(strftime('%s', 'now') AS INTEGER) FROM recipients;

WITH recipients AS (
  SELECT DISTINCT p.user_id FROM team_challenge_progress p
  JOIN team_challenges c ON c.id = p.challenge_id
  WHERE c.is_completed = 1 AND c.is_cancelled = 0 AND p.is_completed = 1
)
INSERT OR IGNORE INTO community_notifications (id, user_id, type, content, is_read, created_at)
SELECT 'badge:team_champion:' || r.user_id, r.user_id, 'achievement',
  '🎖️ 你获得了徽章「团队冠军」', 0, CAST(strftime('%s', 'now') AS INTEGER)
FROM recipients r
WHERE NOT EXISTS (SELECT 1 FROM community_notifications n
  WHERE n.user_id = r.user_id AND n.type = 'achievement' AND n.content = '🎖️ 你获得了徽章「团队冠军」');

WITH recipients AS (
  SELECT DISTINCT p.user_id FROM team_challenge_progress p
  JOIN team_challenges c ON c.id = p.challenge_id
  WHERE c.is_completed = 1 AND c.is_cancelled = 0 AND p.is_completed = 1
)
INSERT OR IGNORE INTO community_posts
  (id, user_id, type, content, tags, image_urls, ref_type, ref_id, created_at, updated_at)
SELECT 'badge:team_champion:' || r.user_id, r.user_id, 'achievement',
  '🎖️ 达成成就「团队冠军」！每一份坚持都算数，继续加油！', '[]', '[]',
  'badge', 'team_champion:' || r.user_id,
  CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER)
FROM recipients r
WHERE NOT EXISTS (SELECT 1 FROM community_posts p
  WHERE p.ref_type = 'badge' AND p.ref_id = 'team_champion:' || r.user_id);
