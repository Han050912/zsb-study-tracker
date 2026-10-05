-- Learning rewards spend UTC+8 daily allowance permanently. Existing ledger rows seed the first
-- request for that user/day; nothing is retroactively removed. Apply before deploying the Worker.
CREATE TABLE IF NOT EXISTS study_reward_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  spent INTEGER NOT NULL DEFAULT 0 CHECK (spent >= 0),
  last_grant INTEGER NOT NULL DEFAULT 0 CHECK (last_grant >= 0),
  PRIMARY KEY (user_id, date)
);
