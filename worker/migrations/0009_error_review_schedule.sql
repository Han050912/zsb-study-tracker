-- Existing databases: apply before deploying the Worker with review schedule mapping.
ALTER TABLE error_questions ADD COLUMN last_reviewed_at INTEGER;
ALTER TABLE error_questions ADD COLUMN next_review_date TEXT;
