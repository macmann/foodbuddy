-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OK', 'ERROR', 'NO_RESULTS');

-- AlterTable
ALTER TABLE "RecommendationEvent"
ADD COLUMN     "status" "RecommendationStatus" NOT NULL DEFAULT 'OK',
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "resultCount" INTEGER DEFAULT 0;
