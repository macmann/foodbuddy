-- Create SearchSession table if missing
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

-- Ensure expected columns exist if the table pre-dated this migration
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
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);
  END IF;
END $$;

-- Backfill sessionId + location fields when possible
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SearchSession'
      AND column_name = 'sessionId'
  ) THEN
    UPDATE "SearchSession" SET "sessionId" = "id" WHERE "sessionId" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SearchSession'
      AND column_name = 'lat'
  ) THEN
    EXECUTE 'UPDATE "SearchSession" SET "lastLat" = "lat" WHERE "lastLat" IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SearchSession'
      AND column_name = 'lng'
  ) THEN
    EXECUTE 'UPDATE "SearchSession" SET "lastLng" = "lng" WHERE "lastLng" IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SearchSession'
      AND column_name = 'radius'
  ) THEN
    EXECUTE 'UPDATE "SearchSession" SET "lastRadiusM" = "radius" WHERE "lastRadiusM" IS NULL';
  END IF;
END $$;

-- Drop legacy columns if present
ALTER TABLE "SearchSession"
  DROP COLUMN IF EXISTS "lat",
  DROP COLUMN IF EXISTS "lng",
  DROP COLUMN IF EXISTS "radius";

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "SearchSession_sessionId_key" ON "SearchSession"("sessionId");
