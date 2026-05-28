import { describe, it, expect } from "vitest";

// v96 — the digest fan-out N+1 fix changed sendToMany from a per-
// user findMany loop into a single batched query. This guard
// documents the invariant via a source-shape test so a regression
// (someone adding a sequential `for (uid of userIds)` loop back in)
// is caught locally before deploying.

describe("sendToMany batching invariant", () => {
  it("uses a single findMany with userId: { in: userIds }", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../src/services/push/webpush.service.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/userId:\s*\{\s*in:\s*userIds\s*\}/);
    // No per-user loop calling sendToUser anywhere in the file (the
    // old N+1 pattern was `for (const uid of userIds) sendToUser(...)`).
    expect(src).not.toMatch(/for\s*\(.*uid.*of\s+userIds[\s\S]{0,80}sendToUser/);
  });

  it("races each webpush call against a deadline", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../src/services/push/webpush.service.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/Promise\.race/);
    expect(src).toMatch(/PUSH_TIMEOUT_MS/);
  });
});
