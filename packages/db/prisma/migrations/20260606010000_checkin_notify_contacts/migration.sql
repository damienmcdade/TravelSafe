-- v113 — persist which trusted contacts a check-in timer should alert on expiry.
-- Empty array (the default) means "notify ALL confirmed contacts", preserving
-- prior behavior for every existing row.
ALTER TABLE "CheckInTimer" ADD COLUMN "notifyContactIds" TEXT[] NOT NULL DEFAULT '{}';
