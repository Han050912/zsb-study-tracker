-- Apply before deploying the Worker; retained jobs make object removal retryable.
CREATE TABLE IF NOT EXISTS r2_cleanup_jobs (
  r2_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_images_r2_key ON error_images(r2_key);
