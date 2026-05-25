import { env } from "../../lib/env";
import type { AreaRiskAlert, AreaStats, CrimeDataAdapter, Incident } from "./types";
import { sandagSocrataAdapter } from "./adapters/sandag-socrata";
import { sdpdNibrsAdapter } from "./adapters/sdpd-nibrs";
import { mockAdapter } from "./adapters/mock";
import { cityForArea, CITIES } from "./cities";

export * from "./types";

const adapters: Record<string, CrimeDataAdapter> = {
  sandag: sandagSocrataAdapter,
  sdpd: sdpdNibrsAdapter,
  mock: mockAdapter,
};

async function tryAdapter<T>(adapter: CrimeDataAdapter, run: (a: CrimeDataAdapter) => Promise<T>): Promise<T | null> {
  try {
    return await run(adapter);
  } catch (err) {
    console.warn(`[crime-data] adapter ${adapter.name} failed:`, (err as Error).message);
    return null;
  }
}

// The mock adapter ships sample San Diego rows (Pacific Beach / Downtown)
// dated to "now - N days" so they always look recent. It exists so local
// developers can spin up the app without provisioning every upstream
// city's API access. It MUST NEVER serve real users in production —
// fabricated rows would otherwise appear with provenance "about:blank"
// and pass through the UI as if they were authoritative police data.
// The audit caught the dispatcher quietly falling back to mock when the
// real adapter was empty AND no LKG cache existed.
const MOCK_FALLBACK_ALLOWED = process.env.NODE_ENV !== "production" || env.CRIME_DATA_ADAPTER === "mock";

// ----- Last-known-good cache --------------------------------------------
// Generalizes the SDPD lastDiscovered pattern to every adapter at the
// dispatcher layer. When an adapter returns empty or null for a query
// we've previously satisfied with non-empty data, serve the last
// successful response instead of an empty list. Bounded by Vercel
// instance lifetime (module memory) so cold starts always re-pull
// fresh from the upstream — the LKG only protects against transient
// upstream failures within a warm instance.
//
// Cache key omits opts (limit/since) on purpose: the LKG is a
// "something is better than nothing" fallback, not a precise replay
// of the original query. Callers asking for limit=50 from a 500-row
// LKG will get 500 rows — slightly more than asked, never silently
// empty. The Crime Map / Watch UIs apply their own slicing.
const lkgIncidents = new Map<string, Incident[]>();
const lkgAreaStats = new Map<string, AreaStats>();
const lkgRecentReports = new Map<string, Incident[]>();
// No standalone LKG for getCitywide — it composes getIncidents per area,
// which already benefits from lkgIncidents. The citywide aggregator
// naturally inherits the LKG fallback via its component calls.

/// Picks adapter(s) per CRIME_DATA_ADAPTER. In "auto" mode, real adapters are
/// tried in order and fall through to the mock if both fail — guaranteeing
/// the UI always renders something.
export const crimeData = {
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getAreaStats(area);
    // Route by city: LA-prefixed slugs hit LAPD, others hit SDPD primary.
    const cityAdapter = cityForArea(area).adapter;
    const stats = await tryAdapter(cityAdapter, (a) => a.getAreaStats(area));
    if (stats) {
      lkgAreaStats.set(area, stats);
      return stats;
    }
    // SANDAG jurisdiction-level stats still answer for city-of-SD overview.
    if (cityAdapter === sdpdNibrsAdapter) {
      const sandag = await tryAdapter(sandagSocrataAdapter, (a) => a.getAreaStats(area));
      if (sandag) {
        lkgAreaStats.set(area, sandag);
        return sandag;
      }
    }
    // LKG fallback before mock — a previously-cached real response
    // beats a synthetic mock when the upstream is briefly down.
    const lkg = lkgAreaStats.get(area);
    if (lkg) return lkg;
    if (!MOCK_FALLBACK_ALLOWED) return null;
    return mockAdapter.getAreaStats(area);
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }): Promise<Incident[]> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getIncidents(area, opts);
    const cityAdapter = cityForArea(area).adapter;
    const incidents = await tryAdapter(cityAdapter, (a) => a.getIncidents(area, opts));
    if (incidents && incidents.length > 0) {
      lkgIncidents.set(area, incidents);
      return incidents;
    }
    const lkg = lkgIncidents.get(area);
    if (lkg && lkg.length > 0) return lkg;
    if (!MOCK_FALLBACK_ALLOWED) return incidents ?? [];
    return incidents ?? (await mockAdapter.getIncidents(area, opts));
  },

  async getRecentReports(area: string, opts?: { limit?: number }): Promise<Incident[]> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getRecentReports(area, opts);
    const cityAdapter = cityForArea(area).adapter;
    const reports = await tryAdapter(cityAdapter, (a) => a.getRecentReports(area, opts));
    if (reports && reports.length > 0) {
      lkgRecentReports.set(area, reports);
      return reports;
    }
    const lkg = lkgRecentReports.get(area);
    if (lkg && lkg.length > 0) return lkg;
    if (!MOCK_FALLBACK_ALLOWED) return reports ?? [];
    return reports ?? (await mockAdapter.getRecentReports(area, opts));
  },

  /// Citywide aggregate for the Awareness tab default view. Sums incidents
  /// across all known SD neighborhoods and emits one alert card per NIBRS
  /// category so users get a city-of-San-Diego overview without picking an area.
  /// Per-area payload now carries a category breakdown so the Crime Map can
  /// surface "what kind of incidents drive this area's score" in its tooltip.
  async getCitywide(citySlug: string = "san-diego", opts: { offense?: string; windowDays?: number } = {}): Promise<{
    city: string;
    totalIncidents: number;
    appliedOffense: string | null;
    /// The window applied when counting incidents. null = no window
    /// (every cached incident counts, the legacy behavior).
    windowDays: number | null;
    topOffenses: Array<{ offense: string; count: number }>;
    alerts: AreaRiskAlert[];
    perArea: Array<{
      slug: string;
      label: string;
      incidentCount: number;
      riskLevel: 1 | 2 | 3 | 4 | 5;
      byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number };
      dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null;
    }>;
  }> {
    const { cityBySlug } = await import("./cities");
    const city = cityBySlug(citySlug) ?? CITIES[0];
    const areas = await city.discover().catch(() => [] as Awaited<ReturnType<typeof city.discover>>);
    const offenseFilter = opts.offense?.toLowerCase().trim();
    // Wall-clock window. Anchored to Date.now() so the cutoff doesn't
    // drift between refreshes — same pattern the safety-score
    // annualization uses (commit 1f7d7d9). null means "no window",
    // matching the legacy behavior for backwards compat.
    const windowDays = opts.windowDays && opts.windowDays > 0 ? Math.floor(opts.windowDays) : null;
    const windowCutoffMs = windowDays != null ? Date.now() - windowDays * 24 * 60 * 60 * 1000 : null;
    const inWindow = (occurredAt: string): boolean => {
      if (windowCutoffMs == null) return true;
      const t = +new Date(occurredAt);
      return Number.isFinite(t) && t >= windowCutoffMs;
    };
    const perArea: Awaited<ReturnType<typeof crimeData.getCitywide>>["perArea"] = [];
    const totalByCategory = new Map<string, Incident[]>();
    const offenseCounts = new Map<string, number>();
    // Parallelize the per-area fetch. The adapter caches its upstream pull
    // so for a city of N areas we still only hit the police feed ONCE on
    // cold cache regardless of how many areas the loop iterates — but each
    // per-area dispatch into our cache has a few ms of in-process overhead.
    // Sequential await stacked that overhead into ~1s for Detroit (199 areas)
    // / Oakland (134 areas); Promise.all collapses it into one effective
    // round-trip. The serial loop was the dominant blocker on first paint
    // of the Crime Map.
    const incidentsAllPerArea = await Promise.all(
      // No artificial per-area cap. Earlier we limited to 500 which made every
      // busy neighborhood show the same flat 500 number — destroying the visual
      // hierarchy on the Crime Map and undermining user trust in the numbers.
      areas.map((a) => this.getIncidents(a.slug, { limit: Number.MAX_SAFE_INTEGER }).catch(() => [])),
    );
    for (let i = 0; i < areas.length; i++) {
      const area = areas[i];
      // Apply the recency window BEFORE offense / category counting
      // so the totals + breakdowns reflect the user-selected interval.
      // No window → keep every cached incident (legacy behavior).
      const incidentsAll = windowCutoffMs == null
        ? incidentsAllPerArea[i]
        : incidentsAllPerArea[i].filter((inc) => inWindow(inc.occurredAt));
      // Accumulate the full top-offenses list across the city so the UI's
      // offense-dropdown can show all options.
      for (const inc of incidentsAll) {
        const off = inc.ibrOffenseDescription;
        offenseCounts.set(off, (offenseCounts.get(off) ?? 0) + 1);
      }
      const incidents = offenseFilter
        ? incidentsAll.filter((inc) => inc.ibrOffenseDescription.toLowerCase() === offenseFilter)
        : incidentsAll;
      const byCategory = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
      for (const inc of incidents) {
        const k = inc.nibrsCategory as keyof typeof byCategory;
        if (k in byCategory) byCategory[k] += 1;
        const arr = totalByCategory.get(inc.nibrsCategory) ?? [];
        arr.push(inc);
        totalByCategory.set(inc.nibrsCategory, arr);
      }
      const dominantCategory = (Object.entries(byCategory) as Array<["PERSONS" | "PROPERTY" | "SOCIETY", number]>)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      // riskLevel is computed RELATIVE to other neighborhoods in this
      // same city below (after the loop) — see the percentile pass.
      // Stash the raw count here; we'll rewrite it once we know the
      // distribution. Default to 1 so the schema is satisfied.
      perArea.push({ slug: area.slug, label: area.label, incidentCount: incidents.length, riskLevel: 1, byCategory, dominantCategory: incidents.length > 0 ? dominantCategory : null });
    }
    // Cross-city normalization (v23 audit fix): the prior per-adapter
    // absolute-count cutoffs meant a Pacific Beach neighborhood with
    // 150 incidents could rate 3 in San Diego but 5 in Kansas City,
    // making the riskLevel meaningless across cities. Recompute now
    // as PERCENTILE-WITHIN-CITY so the badge always means "how does
    // this neighborhood compare to others in YOUR city" — same
    // semantic everywhere. Bands:
    //   top 10%     → 5 (worst)
    //   next 20%    → 4
    //   middle 40%  → 3
    //   next 20%    → 2
    //   bottom 10%  → 1 (best)
    {
      const sorted = perArea
        .map((p, i) => ({ i, count: p.incidentCount }))
        .sort((a, b) => b.count - a.count); // descending
      const n = sorted.length;
      if (n > 0) {
        for (let rank = 0; rank < n; rank++) {
          const pct = rank / n; // 0 = worst, ~1 = best
          let lvl: 1 | 2 | 3 | 4 | 5;
          if (pct < 0.10) lvl = 5;
          else if (pct < 0.30) lvl = 4;
          else if (pct < 0.70) lvl = 3;
          else if (pct < 0.90) lvl = 2;
          else lvl = 1;
          // Neighborhoods with ZERO incidents always fall to 1, even
          // if they happen to land in a higher percentile bucket
          // (e.g. a small city where most neighborhoods have 0 and
          // a couple have 1).
          if (sorted[rank].count === 0) lvl = 1;
          perArea[sorted[rank].i].riskLevel = lvl;
        }
      }
    }
    const topOffenses = Array.from(offenseCounts.entries())
      .map(([offense, count]) => ({ offense, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
    const sample = perArea[0] ? await this.getAreaStats(perArea[0].slug) : null;
    const alerts: AreaRiskAlert[] = Array.from(totalByCategory.entries()).map(([category, items]) => ({
      area: `City of ${city.label}`,
      category: category as AreaRiskAlert["category"],
      riskLevel: items.length > 800 ? 5 : items.length > 400 ? 4 : items.length > 150 ? 3 : items.length > 40 ? 2 : 1,
      summary: `${items.length} ${category.toLowerCase()} incidents reported across ${city.label} neighborhoods in the cached window.`,
      recency: sample?.provenance.recency ?? "see source",
      provenance: sample?.provenance ?? {
        source: `${city.label} public crime data`,
        datasetUrl: "about:blank",
        recency: "see adapter",
        granularity: "neighborhood",
        disclaimer: `Aggregated for ${city.label}. Not live, not street-level.`,
      },
    }));
    const totalIncidents = perArea.reduce((s, a) => s + a.incidentCount, 0);
    return {
      city: city.label,
      totalIncidents,
      appliedOffense: offenseFilter ?? null,
      windowDays,
      topOffenses,
      alerts,
      perArea: perArea.sort((a, b) => b.incidentCount - a.incidentCount),
    };
  },

  /// Citywide variant of getAreaStats. Aggregates incident totals across
  /// every neighborhood of a city and emits the same AreaStats shape so
  /// the UI renders with one branch. Replaces the previous "pass the
  /// city slug as a neighborhood" anti-pattern that returned null when
  /// the slug wasn't a real area.
  async getCitywideAreaStats(citySlug: string = "san-diego"): Promise<AreaStats | null> {
    const { cityBySlug } = await import("./cities");
    const city = cityBySlug(citySlug);
    if (!city) return null;
    const areas = await city.discover().catch(() => []);
    if (areas.length === 0) {
      // Fall back to a representative sample so the UI gets *something*
      // (provenance + recency labels), rather than 500-ing out the
      // citywide view. The provenance defaults are honest about scope.
      return {
        area: `${city.label} (citywide)`,
        crimeRate: null,
        violentCrimeRate: null,
        propertyCrimeRate: null,
        riskLevel: 1,
        provenance: {
          source: `${city.label} public crime data`,
          datasetUrl: "about:blank",
          recency: "see adapter",
          granularity: "jurisdiction",
          disclaimer: `Aggregated for ${city.label}. Not live, not street-level.`,
        },
      };
    }
    // Sample provenance from the first area — the adapter shares its
    // upstream pull across every area of the city, so any single area's
    // provenance is representative of the citywide pull.
    const sample = await this.getAreaStats(areas[0].slug);
    // Sum incidents across all areas, then bucket by category to compute
    // citywide violent / property rates. We don't use getCitywide here
    // because that response shape doesn't match AreaStats; we want a
    // single AreaStats payload so consumers of /api/crime-data/area-stats
    // can switch between per-area and citywide without branching.
    const perAreaCounts = await Promise.all(
      areas.map(async (a) => {
        const incs = await this.getIncidents(a.slug, { limit: 1000 }).catch(() => []);
        let persons = 0, property = 0;
        for (const i of incs) {
          if (i.nibrsCategory === "PERSONS") persons += 1;
          else if (i.nibrsCategory === "PROPERTY") property += 1;
        }
        return { total: incs.length, persons, property };
      }),
    );
    const totals = perAreaCounts.reduce(
      (acc, c) => ({ total: acc.total + c.total, persons: acc.persons + c.persons, property: acc.property + c.property }),
      { total: 0, persons: 0, property: 0 },
    );
    const riskLevel = (
      totals.total > 5000 ? 5 :
      totals.total > 1500 ? 4 :
      totals.total > 400  ? 3 :
      totals.total > 50   ? 2 : 1
    ) as 1 | 2 | 3 | 4 | 5;
    return {
      area: `${city.label} (citywide)`,
      // Per-1,000 rates are intentionally not computed here — they would
      // need a population denominator AND a defined time window, both of
      // which getAreaStats deliberately doesn't carry. The Safety Index
      // endpoint owns the rate math; this surface owns the totals.
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel,
      provenance: sample?.provenance ?? {
        source: `${city.label} public crime data`,
        datasetUrl: "about:blank",
        recency: "see adapter",
        granularity: "jurisdiction",
        disclaimer: `Aggregated for ${city.label}. Not live, not street-level.`,
      },
    };
  },

  /// Derive area-level risk alert cards for the Threat Detection tab from
  /// recent incidents. Returns one alert per NIBRS category present, with a
  /// risk level based on incident count in the window.
  async getAreaAlerts(area: string, opts?: { limit?: number }): Promise<AreaRiskAlert[]> {
    const incidents = await this.getIncidents(area, { limit: opts?.limit ?? 100 });
    if (incidents.length === 0) return [];
    const byCategory = new Map<string, Incident[]>();
    for (const i of incidents) {
      const arr = byCategory.get(i.nibrsCategory) ?? [];
      arr.push(i);
      byCategory.set(i.nibrsCategory, arr);
    }
    const provenance = (incidents[0] as Incident & { provenance?: unknown }).provenance;
    const stats = await this.getAreaStats(area);
    return Array.from(byCategory.entries()).map(([category, items]) => ({
      area,
      category: category as AreaRiskAlert["category"],
      riskLevel: items.length > 60 ? 5 : items.length > 30 ? 4 : items.length > 10 ? 3 : items.length > 3 ? 2 : 1,
      summary: `${items.length} ${category.toLowerCase()} incidents reported in the cached window.`,
      recency: stats?.provenance.recency ?? "see source",
      provenance: stats?.provenance ?? (provenance as AreaRiskAlert["provenance"]),
    }));
  },
};
