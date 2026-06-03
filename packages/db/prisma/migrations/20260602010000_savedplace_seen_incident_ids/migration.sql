-- fix(audit safezone-proximity-occurredat-lag-miss): bounded set of incident IDs
-- the proximity worker has already accounted for at a place, so out-of-order
-- (lagged) publications are detected by ID rather than a high-water timestamp.
-- AlterTable
ALTER TABLE "SavedPlace" ADD COLUMN "seenIncidentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
