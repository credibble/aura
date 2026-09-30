-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "handles" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "image" TEXT,
    "imageFit" TEXT,
    "baseline" DOUBLE PRECISION NOT NULL,
    "volatility" DOUBLE PRECISION NOT NULL,
    "allowedSources" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "fetchIntervalMs" INTEGER NOT NULL,
    "transport" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_items" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "url" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engagement" DOUBLE PRECISION,
    "dedupeKey" TEXT NOT NULL,
    "media" JSONB,

    CONSTRAINT "source_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handle_scores" (
    "itemId" TEXT NOT NULL,
    "handleId" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "sentiment" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handle_scores_pkey" PRIMARY KEY ("itemId","handleId")
);

-- CreateTable
CREATE TABLE "window_results" (
    "handleId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "s" DOUBLE PRECISION NOT NULL,
    "expectation" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "indexOpen" DOUBLE PRECISION NOT NULL,
    "indexClose" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "proof" JSONB,
    "outcomeDominance" JSONB,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    "resolutionHash" TEXT NOT NULL,

    CONSTRAINT "window_results_pkey" PRIMARY KEY ("handleId","windowStart")
);

-- CreateTable
CREATE TABLE "feed_events" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "change" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "feed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "handleId" TEXT NOT NULL,
    "expectation" DOUBLE PRECISION NOT NULL,
    "lastS" DOUBLE PRECISION NOT NULL,
    "lastIndex" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("handleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_items_dedupeKey_key" ON "source_items"("dedupeKey");

-- CreateIndex
CREATE INDEX "source_items_sourceId_publishedAt_idx" ON "source_items"("sourceId", "publishedAt");

-- CreateIndex
CREATE INDEX "source_items_collectedAt_idx" ON "source_items"("collectedAt");

-- CreateIndex
CREATE INDEX "handle_scores_handleId_relevance_idx" ON "handle_scores"("handleId", "relevance");

-- CreateIndex
CREATE UNIQUE INDEX "window_results_resolutionHash_key" ON "window_results"("resolutionHash");

-- CreateIndex
CREATE INDEX "feed_events_assetId_ts_idx" ON "feed_events"("assetId", "ts");

-- AddForeignKey
ALTER TABLE "handle_scores" ADD CONSTRAINT "handle_scores_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "source_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

