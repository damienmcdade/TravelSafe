-- v113 — Live Share now conveys the sharer's LIVE location. Their device POSTs
-- its current position to /api/safety/live-share/heartbeat; the recipient's
-- /share/<token> page polls /api/share/<token> for it and renders a live map.
-- Columns are nullable: a share with no heartbeat yet shows "waiting for
-- location" rather than a stale or fabricated point. Additive, no backfill.
ALTER TABLE "LiveShareLink" ADD COLUMN "lastLat" DOUBLE PRECISION;
ALTER TABLE "LiveShareLink" ADD COLUMN "lastLng" DOUBLE PRECISION;
ALTER TABLE "LiveShareLink" ADD COLUMN "lastLocationAt" TIMESTAMP(3);
