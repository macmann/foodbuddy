ALTER TABLE "RecommendationEvent"
ADD COLUMN "requestId" TEXT,
ADD COLUMN "locationEnabled" BOOLEAN,
ADD COLUMN "radiusMeters" INTEGER,
ADD COLUMN "source" TEXT,
ADD COLUMN "agentEnabled" BOOLEAN,
ADD COLUMN "llmModel" TEXT,
ADD COLUMN "toolCallCount" INTEGER,
ADD COLUMN "fallbackUsed" BOOLEAN,
ADD COLUMN "rawResponseJson" TEXT;
