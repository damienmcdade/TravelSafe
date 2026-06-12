# Deep Whole-Application Analysis — 2026-06-12

Methodology-driven analysis of the entire monorepo, run against published quality
models rather than ad-hoc review. Frameworks applied: **ISO/IEC 25010** (SQuaRE
quality characteristics), **SIG/TÜViT Trusted Product Maintainability** (volume,
duplication, unit size/complexity thresholds), **SonarSource** cognitive-complexity
guidance, **Core Web Vitals** thresholds, and tool-based evidence from **knip**
(dead code & dependency hygiene), **madge** (circular dependencies), **jscpd**
(duplication, SIG-comparable 6-line blocks), and **type-coverage** (strict mode).
This complements — does not repeat — the security-focused audit in
`AUDIT-FULL-2026-06-02.md` (OWASP ASVS/Top-10/CWE coverage lives there).

## Scorecard

| Dimension | Result | Benchmark | Verdict |
|---|---|---|---|
| Type coverage (strict) | web **99.18%**, api **99.88%**, crime-data **99.95%** | ≥ 99% (type-coverage strict bar) | ✅ pass |
| Type escape hatches | 3 × `as any` total, 0 × `@ts-ignore`/`@ts-expect-error` | minimal | ✅ excellent |
| `strict` compiler mode | inherited by all 4 workspaces via `tsconfig.base.json` | required | ✅ pass |
| Duplication (jscpd, 6-line blocks) | **6.24%** (266 clones) | SIG 4★ < 5%; Sonar new-code ≤ 3% | ⚠️ slightly over |
| Circular dependencies | crime-data **46** (one hub cycle), web **1**, api **0** | 0 | ⚠️ documented |
| Dead files (knip, after triage) | **10 confirmed** → deleted this pass | 0 | ✅ fixed |
| Unlisted dependencies | 3 confirmed → fixed this pass | 0 | ✅ fixed |
| Volume | ~190k LOC TS across workspaces (web 73k / api 47k / crime-data 29k / db 41k — db is mostly generated seed data) | SIG: smaller = better | ✅ favorable band |
| Tests | 132/132 passing (20 files) + registry invariant suite | — | ✅ green |

## Changes shipped in this pass

### Dead code deleted (verified, not just knip output)
Every knip "unused file" claim was independently verified by reference search
before action — knip had 4 false positives that were **kept**:
`sw.js` (registered at runtime via `navigator.serviceWorker.register` in
`apps/web/src/lib/push.ts`), `CrimeChart` (6 imports),
`apps/api/src/services/crime-data/neighborhoods.ts` and `insights.service.ts`
(imported — one dynamically — by `crime-data.routes.ts`).

Confirmed dead and deleted:
- `apps/api/src/services/crime-data/adapters/{mock,sandag-socrata,sdpd-nibrs}.adapter.ts`,
  `index.ts`, `types.ts` — a pre-`@travelsafe/crime-data` San-Diego-only adapter
  layer; its sole importer was its own `index.ts`, which nothing imports. The
  live 45-city adapter registry in `packages/crime-data` is untouched.
- `apps/web/src/components/{AppIcon,CategoryBreakdown,IncidentCard,NationalAverageCard,RecentIncidentsCards}.tsx`
  — zero-reference chains (IncidentCard's only importer was RecentIncidentsCards,
  itself unreferenced; AppIcon is not used by the icon pipeline, which renders
  from `scripts/icon-master.png` via sharp).

### Dependency hygiene fixed
- `csv-parse` added to `packages/crime-data` (used by `src/adapters/sdpd-nibrs.ts`;
  previously resolved only by hoisting luck).
- `bcryptjs` + `@types/bcryptjs` added to `packages/db` devDependencies
  (used by `prisma/seed.ts`).
- `@types/geojson` added to `apps/web` devDependencies (used by safe-route,
  official-alerts, CrimeMap; previously hoisted via `@types/leaflet`).
- `csv-parse` removed from `apps/api` (its only consumer was the deleted adapter).
- `package-lock.json` workspace nodes hand-edited in lockstep (regenerating the
  lockfile strips `libc` selectors — see the note in root `package.json`);
  validated with `npm ci --dry-run`.

## Findings documented, deliberately not "fixed" now

1. **Duplication 6.24% vs SIG's <5%** — the top clone pairs are all
   api↔web service twins (~800 lines: incident-summary, sandag adapter,
   AI provider, insights, moderation queue, webpush, contacts, geo,
   suspension). This is the known route-parity architecture (Vercel and
   Railway each run a copy). The right fix is extracting a shared
   `packages/services` — an architectural change, not a cleanup; doing it
   blind risks the working deploy topology. Tracked as the single highest-value
   maintainability refactor.
2. **crime-data cycle hub** — `neighborhoods.ts ↔ cities.ts ↔ adapters/*`
   produces all 46 cycles. It's one design knot (registry imports adapters,
   adapters import registry types/helpers). Runtime-safe today (ESM handles it;
   tests cover registry integrity); breaking it means an interface-extraction
   refactor of 45 adapters. Same for the single web cycle
   (`route/page.tsx ↔ RouteMap.tsx`).
3. **Beyond-strict compiler flags absent** (`noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`) — turning them on today surfaces hundreds of
   errors. Recommended as a ratchet on new code, not a flag-day.
4. **knip residue** — remaining "unused export" hits are exports kept for
   API-surface symmetry in `packages/crime-data`; the `max-old-space-size`
   "unlisted binary" hit is a knip parse artifact of the api build script.

## ISO 25010 traceability

- **Maintainability** — analysability ✅ (type coverage, tiny escape-hatch
  count); modularity ⚠️ (cycles + duplication above); reusability ✅
  (shared crime-data package consumed by both apps); testability ✅ (132 tests,
  registry invariants).
- **Reliability** — fault tolerance ✅ (tiered loaders + LKG caches + AI
  fallback chain + proxy fallbacks); recoverability ✅ (graceful shutdown stops
  all four workers before `server.close()`); availability ✅ (nightly
  sync-check probes 9 endpoints incl. deploy-version coherence).
- **Performance efficiency** — verified via `next build` route budgets and
  production probes; CWV field validation requires CrUX/RUM (not assessable
  from this environment — noted as not assessed).
- Security, privacy, accessibility: assessed separately (2026-06-02 audit;
  note the deliberate WCAG 2.4.1 gap from the skip-link removal directive,
  documented in `apps/web/src/app/(app)/layout.tsx`).
