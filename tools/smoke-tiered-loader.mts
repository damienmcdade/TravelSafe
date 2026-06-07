// v108 smoke test for the shared tiered cold-load helper.
// Run: npx tsx tools/smoke-tiered-loader.mts
import { createTieredLoader } from "../packages/crime-data/src/lib/tiered-loader.ts";
import type { Incident } from "../packages/crime-data/src/types.ts";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function inc(id: string): Incident {
  return { id, area: "A", occurredAt: new Date(1).toISOString(), nibrsCategory: "PROPERTY" as Incident["nibrsCategory"], ibrOffenseDescription: "x", beat: null, blockLabel: undefined, lat: undefined, lng: undefined };
}

(async () => {
  console.log("tiered-loader smoke test\n");

  // --- Tiered: recent tier served first, deep tier merges in background ---
  {
    const calls: Array<[number, number]> = [];
    const loader = createTieredLoader({
      name: "test-tiered",
      recentPages: 2,
      pages: 6,
      fetchRange: async (s, e) => {
        calls.push([s, e]);
        await sleep(10);
        // recent range -> ids r0,r1 ; deep range -> ids r1 (dup), d2,d3
        if (s === 0) return { rows: [inc("r0"), inc("r1")], complete: true };
        return { rows: [inc("r1"), inc("d2"), inc("d3")], complete: true };
      },
    });
    const first = await loader.getRows();
    check("tiered: first call returns recent tier only", first.length === 2 && first.map((r) => r.id).join(",") === "r0,r1", `(got ${first.map((r) => r.id)})`);
    check("tiered: recent tier fetched range [0,2) first", calls[0][0] === 0 && calls[0][1] === 2);
    await sleep(40); // let background deepen finish
    const after = loader.peek();
    check("tiered: deepen ran with range [2,6)", calls.some((c) => c[0] === 2 && c[1] === 6));
    check("tiered: deep tier merged + deduped by id (r0,r1,d2,d3)", !!after && after.length === 4 && new Set(after.map((r) => r.id)).size === 4, `(got ${after?.map((r) => r.id)})`);
  }

  // --- In-flight dedup: concurrent callers share one pull ---
  {
    let rangeCalls = 0;
    const loader = createTieredLoader({
      name: "test-dedup",
      recentPages: 1,
      pages: 1, // non-tiered: single pull, no deepen
      fetchRange: async () => { rangeCalls++; await sleep(20); return { rows: [inc("a")], complete: true }; },
    });
    const [a, b, c] = await Promise.all([loader.getRows(), loader.getRows(), loader.getRows()]);
    check("dedup: 3 concurrent callers triggered ONE fetch", rangeCalls === 1, `(got ${rangeCalls})`);
    check("dedup: all callers got the rows", a.length === 1 && b.length === 1 && c.length === 1);
  }

  // --- TTL: second call within TTL serves cache, no refetch ---
  {
    let rangeCalls = 0;
    const loader = createTieredLoader({
      name: "test-ttl",
      recentPages: 1,
      pages: 1,
      ttlMs: 60_000,
      fetchRange: async () => { rangeCalls++; return { rows: [inc("a")], complete: true }; },
    });
    await loader.getRows();
    await loader.getRows();
    check("ttl: second call within TTL did NOT refetch", rangeCalls === 1, `(got ${rangeCalls})`);
  }

  // --- Empty cold pull -> returns [] gracefully, no throw ---
  {
    const loader = createTieredLoader({
      name: "test-empty",
      recentPages: 2,
      pages: 6,
      fetchRange: async () => ({ rows: [], complete: false }),
    });
    const rows = await loader.getRows();
    check("empty: cold pull with no rows returns [] (no throw)", Array.isArray(rows) && rows.length === 0);
  }

  // --- fetchRange throws -> returns last-known-good ([] when never warmed) ---
  {
    let first = true;
    const loader = createTieredLoader({
      name: "test-throw",
      recentPages: 1,
      pages: 1,
      ttlMs: 1, // expire immediately so the 2nd call refetches
      fetchRange: async () => { if (first) { first = false; return { rows: [inc("warm")], complete: true }; } throw new Error("upstream down"); },
    });
    const warm = await loader.getRows();
    check("lkg: first pull warms cache", warm.length === 1);
    await sleep(5);
    const afterFail = await loader.getRows();
    check("lkg: a failing refetch serves last-known-good rows", afterFail.length === 1 && afterFail[0].id === "warm", `(got ${afterFail.map((r) => r.id)})`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
