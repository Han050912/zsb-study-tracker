-- Existing rows have no reliable early-stop marker; retain their original completion semantics.
-- Apply before running the Worker version that reads/writes completed.
ALTER TABLE pomodoro_records ADD COLUMN completed INTEGER NOT NULL DEFAULT 1 CHECK (completed IN (0, 1));
