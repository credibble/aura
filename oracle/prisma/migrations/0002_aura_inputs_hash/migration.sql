-- The aura series carries the evidence hash of the tick that produced each
-- point, so a window resolution can commit it on-chain (ResolutionReceipt).
ALTER TABLE "metric_points" ADD COLUMN "inputsHash" TEXT;
