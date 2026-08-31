-- Source Bridge Live foundation. Live-only tables — no financial schema changes.

CREATE TABLE IF NOT EXISTS "LiveSession" (
    "id" TEXT NOT NULL,
    "broadcasterId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CLOUDFLARE',
    "providerInputId" TEXT NOT NULL DEFAULT '',
    "providerVideoId" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "wasLiveUntil" TIMESTAMP(3),
    "endedReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "activeLock" TEXT,
    "recordingCleanupStatus" TEXT NOT NULL DEFAULT '',
    "recordingCleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "recordingCleanupError" TEXT NOT NULL DEFAULT '',
    "recordingDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiveReport" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LiveSession_activeLock_key" ON "LiveSession"("activeLock");
CREATE INDEX IF NOT EXISTS "LiveSession_status_startedAt_idx" ON "LiveSession"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "LiveSession_broadcasterId_createdAt_idx" ON "LiveSession"("broadcasterId", "createdAt");
CREATE INDEX IF NOT EXISTS "LiveSession_broadcasterId_status_idx" ON "LiveSession"("broadcasterId", "status");
CREATE INDEX IF NOT EXISTS "LiveSession_wasLiveUntil_status_idx" ON "LiveSession"("wasLiveUntil", "status");
CREATE INDEX IF NOT EXISTS "LiveSession_cooldownUntil_idx" ON "LiveSession"("cooldownUntil");
CREATE INDEX IF NOT EXISTS "LiveSession_endsAt_status_idx" ON "LiveSession"("endsAt", "status");
CREATE INDEX IF NOT EXISTS "LiveSession_recordingCleanupStatus_endedAt_idx" ON "LiveSession"("recordingCleanupStatus", "endedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "LiveReport_liveSessionId_reporterUserId_key" ON "LiveReport"("liveSessionId", "reporterUserId");
CREATE INDEX IF NOT EXISTS "LiveReport_status_createdAt_idx" ON "LiveReport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "LiveReport_liveSessionId_createdAt_idx" ON "LiveReport"("liveSessionId", "createdAt");

-- Partial unique: at most one PREPARING/LIVE session per broadcaster (DB-level).
CREATE UNIQUE INDEX IF NOT EXISTS "LiveSession_one_active_per_broadcaster"
  ON "LiveSession"("broadcasterId")
  WHERE "status" IN ('PREPARING', 'LIVE');

DO $$ BEGIN
  ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_broadcasterId_fkey"
    FOREIGN KEY ("broadcasterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LiveReport" ADD CONSTRAINT "LiveReport_liveSessionId_fkey"
    FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LiveReport" ADD CONSTRAINT "LiveReport_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
