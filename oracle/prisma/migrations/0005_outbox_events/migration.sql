-- Outbox: events recorded in the same transaction as the row they announce, so
-- a crash between commit and publish is retried by the drainer instead of losing
-- the push. Drained to the WS event stream.
CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outbox_events_publishedAt_createdAt_idx"
  ON "outbox_events" ("publishedAt", "createdAt");
