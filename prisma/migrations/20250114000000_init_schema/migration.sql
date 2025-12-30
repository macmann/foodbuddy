-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- Create enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Channel') THEN
    CREATE TYPE "Channel" AS ENUM ('WEB', 'TELEGRAM', 'VIBER', 'MESSENGER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ModerationStatus') THEN
    CREATE TYPE "ModerationStatus" AS ENUM ('ACTIVE', 'HIDDEN');
  END IF;
END $$;

-- Create tables
CREATE TABLE IF NOT EXISTS "Place" (
  "placeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "googleRating" DOUBLE PRECISION,
  "googleRatingsTotal" INTEGER,
  "priceLevel" INTEGER,
  "types" JSONB,
  "mapsUrl" TEXT,
  "lastFetchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Place_pkey" PRIMARY KEY ("placeId")
);

CREATE TABLE IF NOT EXISTS "RecommendationEvent" (
  "id" TEXT NOT NULL,
  "channel" "Channel" NOT NULL,
  "userIdHash" TEXT NOT NULL,
  "userLat" DOUBLE PRECISION,
  "userLng" DOUBLE PRECISION,
  "queryText" TEXT NOT NULL,
  "recommendedPlaceIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlaceFeedback" (
  "id" TEXT NOT NULL,
  "placeId" TEXT NOT NULL,
  "channel" "Channel" NOT NULL,
  "userIdHash" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "commentText" TEXT,
  "tags" JSONB,
  "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaceFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlaceAggregate" (
  "placeId" TEXT NOT NULL,
  "communityRatingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "communityRatingCount" INTEGER NOT NULL DEFAULT 0,
  "tagCounts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "lastUpdatedAt" TIMESTAMP(3),
  CONSTRAINT "PlaceAggregate_pkey" PRIMARY KEY ("placeId")
);

CREATE TABLE IF NOT EXISTS "ChatState" (
  "telegramChatIdHash" TEXT NOT NULL,
  "lastLat" DOUBLE PRECISION NOT NULL,
  "lastLng" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatState_pkey" PRIMARY KEY ("telegramChatIdHash")
);

CREATE TABLE IF NOT EXISTS "RagDocument" (
  "placeId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RagDocument_pkey" PRIMARY KEY ("placeId")
);

-- Ensure expected columns exist on RecommendationEvent if the table pre-dated this migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'RecommendationEvent'
  ) THEN
    ALTER TABLE "RecommendationEvent"
      ADD COLUMN IF NOT EXISTS "channel" "Channel",
      ADD COLUMN IF NOT EXISTS "userIdHash" TEXT,
      ADD COLUMN IF NOT EXISTS "userLat" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "userLng" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "queryText" TEXT,
      ADD COLUMN IF NOT EXISTS "recommendedPlaceIds" JSONB,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "Place_lat_lng_idx" ON "Place"("lat", "lng");
CREATE INDEX IF NOT EXISTS "RecommendationEvent_userIdHash_createdAt_idx" ON "RecommendationEvent"("userIdHash", "createdAt");
CREATE INDEX IF NOT EXISTS "PlaceFeedback_placeId_createdAt_idx" ON "PlaceFeedback"("placeId", "createdAt");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaceFeedback_placeId_fkey') THEN
    ALTER TABLE "PlaceFeedback"
      ADD CONSTRAINT "PlaceFeedback_placeId_fkey"
      FOREIGN KEY ("placeId") REFERENCES "Place"("placeId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlaceAggregate_placeId_fkey') THEN
    ALTER TABLE "PlaceAggregate"
      ADD CONSTRAINT "PlaceAggregate_placeId_fkey"
      FOREIGN KEY ("placeId") REFERENCES "Place"("placeId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
