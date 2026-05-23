# TravelSafe — Incidents and How We Prevent Them

A running log of credibility-affecting bugs we've shipped, what caused
them, and the invariants we added so they don't recur. Public-facing
safety data is held to a higher bar than ordinary product work; every
entry here represents a fix that ALSO ships with a guard so the same
class of bug fails loudly next time instead of silently corrupting a
user-visible number.

---

## 2026-05-22 — Safety Index showed 100 ("safer than national") on the Awareness tab for every neighborhood in every city

### Symptom

Users on `/threats` (Awareness tab) saw the same Safety Index value —
100 — regardless of which neighborhood was active. The band chip
read "Fewer reports than national average" universally. This is a
credibility-destroying result because:

- It mis-labels neighborhoods with no available data as "safer" than
  the national average, which is the exact framing the project's
  legal and Fair-Housing guardrails exist to prevent.
- It hides the underlying data-load failure from users — the score
  reads as a confident "we measured this" claim when in fact the
  area was never successfully queried.

### Root cause

`SafeZoneTabSection` (in `apps/web/src/app/(app)/threats/page.tsx`)
fell back to `city.defaultArea` when no neighborhood was picked:

```ts
const effectiveArea = area ?? { slug: city.defaultArea, label: city.label, jurisdiction: city.label };
```

For most cities `defaultArea` is the **city slug** (e.g. `"san-diego"`,
`"chi-loop"`, `"sea-downtown"`), not a neighborhood slug. The
`useSafeZoneData` hook then sent this to `/safezone/safety-score?area=<city-slug>`,
which routed to `getSafetyScore(areaSlug)` — a per-area function.

The per-area function called `crimeData.getIncidents("san-diego")`, which
the SDPD adapter doesn't recognize as a neighborhood, so it returned
`[]`. With `persons = 0` and `property = 0`, the rate math collapsed:

```
localPersonsRate = 0
personsScale = 0 / cityPersons100k = 0
persons100k = cityPersons100k * 0 = 0

ratio = persons100k / 364 = 0
ratioToScore(0) ⇒ returns 100  // because of the `if (ratio <= 0) return 100` guard
band = "safe"
```

The widget rendered 100 / "Lower than national rate" — a confidently
wrong answer.

### Why the existing checks didn't catch it

- `ratioToScore(0) = 100` was a deliberate ceiling for legitimately
  zero-incident areas (a small suburb that genuinely had no reports
  in the window). It correctly handled "real zero" but couldn't
  distinguish "real zero" from "lookup failed".
- The per-area function returned an empty incident list without
  signalling that the slug was unrecognized. A degenerate input
  produced a perfectly-shaped degenerate output.
- The client also had no way to tell "0 reports" from "data load
  failed" — both surfaced as `localPer100k: 0`.

### Fix shipped

Three layered guards so this class of bug fails loudly:

1. **Caller correctness** —
   `apps/web/src/app/(app)/threats/page.tsx` `SafeZoneTabSection`
   now passes `area: null` to `useSafeZoneData` when no neighborhood
   is picked. The previous city-slug fallback is gone. The function
   signature no longer accepts a city-slug-as-area-slug substitution.

2. **Routing correctness** —
   `apps/web/src/components/SafeZoneTab/useSafeZoneData.ts` now
   detects `selection.area === null` and routes to
   `/safezone/safety-score?city=<slug>` instead of
   `/safezone/safety-score?area=<slug>`. The citywide endpoint variant
   calls `getCitywideSafetyScore` which produces the correct
   city-wide BlockScore from actual aggregated data.

3. **Server-side invariant** —
   `apps/web/src/server/services/watch/safety-score.ts` per-area
   function now THROWS 404 when an `areaSlug` returns zero incidents
   AND the slug is not in `city.discover()`'s known-neighborhood list.
   Legitimately quiet neighborhoods (in the discover list, 0 reports
   in window) still return successfully — that's real data. But a
   slug the adapter never heard of can no longer silently return
   a fabricated score.

4. **Client-side visible-unavailability** —
   `apps/web/src/components/SafeZoneTab/BlockScoreWidget.tsx` now
   accepts an `unavailable?: boolean` prop and renders an explicit
   "Safety Index unavailable" panel when the upstream score errored.
   Falling through to "100 / safer than national" on an error is
   no longer possible.

### Invariant pattern for future per-area work

Any function that takes an `areaSlug: string` and returns rates,
scores, or comparisons must:

- Validate the slug against `city.discover()` before computing.
- If the slug is unrecognized, throw an error with `.status = 404`.
- Never return a "zero" sentinel that is indistinguishable from
  legitimate zero data.
- The UI consuming the result must render error/unavailable states
  visibly distinct from "legitimately quiet" results.

### Detection going forward

When adding a new per-area code path, ask:

1. What does this function return when the input slug is unknown to
   the adapter? If the answer is "the same shape as a real result
   but with zeros", add the 404-throw invariant.
2. What does the UI render when the score is 100? Walk through both
   "real low-crime area" and "data load failed" — they MUST look
   different to the user.
