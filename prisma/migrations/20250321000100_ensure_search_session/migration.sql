-- Ensure SearchSession table exists for persisted search state
CREATE TABLE IF NOT EXISTS "SearchSession" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "channel" TEXT,
  "pendingAction" TEXT,
  "pendingKeyword" TEXT,
  "lastLat" DOUBLE PRECISION,
  "lastLng" DOUBLE PRECISION,
  "lastRadiusM" INTEGER,
  "lastQuery" TEXT,
  "nextPageToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SearchSession_sessionId_key" ON "SearchSession"("sessionId");

-- Backfill any missing columns if the table pre-dated this migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'SearchSession'
  ) THEN
    ALTER TABLE "SearchSession"
      ADD COLUMN IF NOT EXISTS "sessionId" TEXT,
      ADD COLUMN IF NOT EXISTS "channel" TEXT,
      ADD COLUMN IF NOT EXISTS "pendingAction" TEXT,
      ADD COLUMN IF NOT EXISTS "pendingKeyword" TEXT,
      ADD COLUMN IF NOT EXISTS "lastLat" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "lastLng" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "lastRadiusM" INTEGER,
      ADD COLUMN IF NOT EXISTS "lastQuery" TEXT,
      ADD COLUMN IF NOT EXISTS "nextPageToken" TEXT,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
  END IF;
END $$;
