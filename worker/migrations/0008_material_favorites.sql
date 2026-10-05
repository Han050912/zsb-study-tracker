-- 现有资料默认不收藏；通过 materials 域的记录级同步持久化收藏状态。
ALTER TABLE materials ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
