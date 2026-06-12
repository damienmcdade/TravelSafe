# CommunitySafe — Incidents and How We Prevent Them

A running log of credibility-affecting bugs we've shipped, what caused
them, and the invariants we added so they don't recur. Public-facing
safety data is held to a higher bar than ordinary product work; every
entry here represents a fix that ALSO ships with a guard so the same
class of bug fails loudly next time instead of silently corrupting a
user-visible number.

---

## 2026-06-10/11 — Production API ran 7-commit-old code for two days; nightly sync-check red with "DEPLOY SKEW"

### Symptom

The nightly `Frontend ↔ Backend Sync Drift` workflow failed two days in a
row (runs 27291426646, 27363902223) with:

```
[DRIFT] deploy version coherence (web vs railway git SHA)
   • DEPLOY SKEW: vercel=ef3b0a4 railway=9abad86
```

Vercel was serving the latest `main` while the Railway API was pinned at
`9abad86` — seven commits behind, missing real API changes that had
"shipped" (Redis-backed rate-limit store `90155e1`, SSE connection caps +
shutdown hardening `32fa9b7`). All eight data-parity probes passed, so
the skew produced no user-visible breakage yet — but the API everyone
believed was deployed was not running. The same failure mode occurred
2026-06-08 (railway=`fa2fc3e`) and is the recurring red nightly.

### Root cause

The `RAILWAY_TOKEN` repo secret was never set. The CI `deploy-railway`
job (added precisely to keep Railway in lockstep with Vercel) handled a
missing token by emitting a `::warning` annotation and **exiting 0** —
so every push to `main` showed a green "Deploy API to Railway" check
while deploying nothing. Railway only ever updated when someone manually
ran `tools/deploy-railway.sh`, and stopped tracking `main` the moment
they stopped.

### Why the existing checks didn't catch it

- The deploy job reported **success** on every push. A warning
  annotation is invisible unless you open the run page.
- The sync-check did catch it — but a day late (nightly schedule), and
  its diagnostic blamed the symptom, not the cause: it recommended a
  bare `railway up`, which `tools/deploy-railway.sh`'s own header
  explains never updates `GIT_COMMIT_SHA` — following the printed advice
  redeploys the code but leaves the probe red.

### Fix shipped

1. **Fail loudly at the source** — `.github/workflows/ci.yml`
   `deploy-railway` now exits 1 with an `::error` when `RAILWAY_TOKEN`
   is unset. A deploy job that cannot deploy is a failure; the red X now
   lands on the exact commit that didn't ship, with the remediation in
   the error message, instead of surfacing a day later in a different
   workflow.
2. **Correct remediation hint** — `tools/sync-check.mjs`'s DEPLOY SKEW
   message now points at `bash tools/deploy-railway.sh` (the
   SHA-stamping wrapper) and warns that bare `railway up` leaves the
   probe red.

### Remaining action (repo owner)

Only the repo owner can mint a Railway project token for
`communitysafe-api` and add it as the `RAILWAY_TOKEN` Actions secret
(Settings → Secrets and variables → Actions). Until that's done, every
push to `main` will now (correctly) fail the deploy job, and the API
must be shipped manually with `bash tools/deploy-railway.sh` after each
merge — which is also what clears the current ef3b0a4/9abad86 skew.

### Invariant pattern

A pipeline step whose job is to ship/verify production must never
"skip-as-success" when its preconditions are missing. Skipping IS the
failure — report it where and when it happens, not via a downstream
monitor a day later.

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
