-- Historical review counts do not imply correct answers.
ALTER TABLE error_questions ADD COLUMN last_review_result TEXT;
ALTER TABLE error_questions ADD COLUMN review_streak INTEGER NOT NULL DEFAULT 0;
