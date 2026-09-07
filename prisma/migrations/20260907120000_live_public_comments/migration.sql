-- Source Bridge Live — canonical public comments (audit + limited recent history).
-- Does not touch payment tables or viewer heartbeat storage.

CREATE TABLE IF NOT EXISTS "LiveComment" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "commenterId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LiveComment_liveSessionId_commenterId_clientMessageId_key"
  ON "LiveComment"("liveSessionId", "commenterId", "clientMessageId");

CREATE INDEX IF NOT EXISTS "LiveComment_liveSessionId_createdAt_idx"
  ON "LiveComment"("liveSessionId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveComment_commenterId_createdAt_idx"
  ON "LiveComment"("commenterId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_liveSessionId_fkey"
    FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_commenterId_fkey"
    FOREIGN KEY ("commenterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
