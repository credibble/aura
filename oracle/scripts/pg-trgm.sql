-- Search quality (gap-closure Phase 4): trigram indexes backing the
-- posts ILIKE search (`SocialService.latestPosts` q → summary/handle/name).
-- Idempotent; re-run after `prisma db push` (npm run db:search-index) since
-- raw indexes live outside the Prisma schema.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS posts_summary_trgm_idx ON posts USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_handle_trgm_idx  ON posts USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_name_trgm_idx    ON posts USING gin (name gin_trgm_ops);
-- body is Json (string[] paragraphs) — indexed on its text cast for future
-- raw-text queries.
CREATE INDEX IF NOT EXISTS posts_body_trgm_idx    ON posts USING gin ((body::text) gin_trgm_ops);
