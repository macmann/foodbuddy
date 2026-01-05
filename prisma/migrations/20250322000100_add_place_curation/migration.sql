DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlaceSource') THEN
    CREATE TYPE "PlaceSource" AS ENUM ('GOOGLE', 'CURATED');
  END IF;
END $$;

ALTER TABLE "Place"
  ADD COLUMN IF NOT EXISTS "externalPlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "source" "PlaceSource" NOT NULL DEFAULT 'GOOGLE',
  ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cuisineTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Place"
SET "externalPlaceId" = "placeId"
WHERE "externalPlaceId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Place_externalPlaceId_key" ON "Place"("externalPlaceId");

ALTER TABLE "PlaceAggregate"
  ADD COLUMN IF NOT EXISTS "foodbuddyRatingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "foodbuddyRatingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "feedbackSummary" TEXT;
