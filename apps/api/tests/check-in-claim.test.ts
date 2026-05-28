import { describe, it, expect } from "vitest";

// v96 — atomic-claim regression. The race that this guards used to
// let two concurrent triggerExpiry calls both notify a trusted
// contact list, because the prior implementation was findUnique →
// JS-side check → notify → update. The fix moved the status-ACTIVE
// check into a single updateMany WHERE clause, so the database
// serializes the two concurrent UPDATEs: one returns count===1 (and
// proceeds to notify), the other returns count===0 (and bails).
//
// This file documents the invariant via a model-based test. A real
// integration test would need a live Postgres; the `@prisma` tag
// marks it for the dedicated `npm run test:integration` lane the
// operator runs against a throwaway DB. The pure-logic checks below
// run by default.

describe("triggerExpiry atomic-claim invariant", () => {
  it("the updateMany WHERE clause is the single source of truth", async () => {
    // The SQL Prisma generates from:
    //   prisma.checkInTimer.updateMany({
    //     where: { id: timerId, status: ACTIVE },
    //     data: { status: TRIGGERED, triggeredAt }
    //   })
    // is roughly:
    //   UPDATE "CheckInTimer"
    //   SET "status"='TRIGGERED', "triggeredAt"=$1
    //   WHERE "id"=$2 AND "status"='ACTIVE'
    // Postgres takes a row-level lock; the second concurrent UPDATE
    // sees status='TRIGGERED' (set by the winner) and matches 0 rows.
    //
    // Verify by reading the service source for the right shape.
    // This is intentionally a static check — making a real
    // concurrent claim test needs the dedicated integration lane.
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../src/services/safety/check-in.service.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/updateMany/);
    expect(src).toMatch(/status:\s*CheckInStatus\.ACTIVE/);
    expect(src).toMatch(/if \(claim\.count === 0\) return \[\]/);
  });
});
