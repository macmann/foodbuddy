-- Create SearchSession table
CREATE TABLE IF NOT EXISTS "SearchSession" (
  "id" TEXT NOT NULL,
  "lastQuery" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "radius" INTEGER NOT NULL,
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
      ADD COLUMN IF NOT EXISTS "lastQuery" TEXT,
      ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "radius" INTEGER,
      ADD COLUMN IF NOT EXISTS "nextPageToken" TEXT,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
  END IF;
END $$;
