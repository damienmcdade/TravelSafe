import { env } from "../env.js";
import { readJson, fetchWithRetry } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { findArea } from "../neighborhoods.js";

// SANDAG Crime Data on the San Diego County Open Data Portal (Socrata).
// Dataset: yearly crime rates per jurisdiction (San Diego, Chula Vista, La Mesa,
// El Cajon, etc.). Confirmed schema:
//   year:number, jurisdiction:text, crime_rate:number,
//   violent_crime_rate:number, property_crime_rate:number
//
// This adapter is ideal for getAreaStats() at JURISDICTION granularity.
// getIncidents / getRecentReports return [] here — the SDPD NIBRS adapter
// covers incident-level data. TODO: expand once SANDAG publishes a
// neighborhood-level incident dataset on the Socrata portal.

interface SodaRow {
  year?: string;
  jurisdiction?: string;
  crime_rate?: string;
  violent_crime_rate?: string;
  property_crime_rate?: string;
}

const PROVENANCE: DataProvenance = {
  source: "SANDAG Crime Data (San Diego County Open Data Portal)",
  datasetUrl: `https://data.sandiegocounty.gov/Safety/SANDAG-Crime-Data/${env.SANDAG_CRIME_RATES_RESOURCE_ID}`,
  recency: "Annual report, latest year per record",
  granularity: "jurisdiction",
  disclaimer:
    "Crime-rate figures are jurisdiction-level annual aggregates published by SANDAG. " +
    "CommunitySafe does not track individuals or street-level incidents.",
};

// Static fallback bands (crime_rate per 1,000 population), the original
// hand-tuned heuristic. Used only when the live regional distribution
// can't be fetched, so behavior degrades to the previously-shipped
// thresholds rather than to something arbitrary.
const STATIC_BANDS = [15, 25, 35, 50] as const;

const BANDS_TTL_MS = 24 * 60 * 60 * 1000; // annual data — a daily refresh is ample
let bandCache: { fetchedAt: number; bands: number[] } | null = null;

/// Linear-interpolated quantile over an ascending-sorted array.
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/// Derive the risk bands from the LIVE distribution of crime rates
/// across every San Diego County jurisdiction's most recent reported
/// year. The resulting quintile breakpoints ARE the "San Diego regional
/// bands" the prior TODO called for: a jurisdiction lands in band N when
/// its rate clears the (N-1)th regional quintile. This self-calibrates
/// as the region's overall crime rate drifts year to year instead of
/// freezing hand-picked thresholds, and it makes "risk" explicitly
/// relative to the region rather than to absolute magic numbers.
///
/// Degrades to STATIC_BANDS whenever the portal is unreachable or
/// returns too few jurisdictions to form meaningful quintiles, so a
/// dead upstream can never blank or distort the risk level.
async function getRegionalBands(): Promise<number[]> {
  const now = Date.now();
  if (bandCache && now - bandCache.fetchedAt < BANDS_TTL_MS) return bandCache.bands;
  try {
    // Socrata can't cheaply do "latest row per group", so pull recent
    // years across all jurisdictions and reduce to one (newest) rate per
    // jurisdiction in JS.
    const rows = await sodaGet({
      $select: "jurisdiction,crime_rate,year",
      $order: "year DESC",
      $limit: "500",
    });
    const latestByJur = new Map<string, number>();
    for (const r of rows) {
      const j = r.jurisdiction?.trim();
      const rate = r.crime_rate != null ? Number(r.crime_rate) : NaN;
      if (!j || !Number.isFinite(rate)) continue;
      // Skip rollup rows ("Region Total", "Countywide") so the
      // distribution reflects real jurisdictions only.
      if (/total|region|countywide/i.test(j)) continue;
      // year DESC means the first row seen per jurisdiction is its newest.
      if (!latestByJur.has(j)) latestByJur.set(j, rate);
    }
    const rates = [...latestByJur.values()].sort((a, b) => a - b);
    if (rates.length < 5) {
      bandCache = { fetchedAt: now, bands: [...STATIC_BANDS] };
      return bandCache.bands;
    }
    const bands = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(rates, q));
    // A degenerate distribution (every jurisdiction near-identical) can
    // yield non-increasing breakpoints, which would collapse the scale —
    // fall back to the static bands in that case.
    const strictlyIncreasing = bands.every((b, i) => i === 0 || b > bands[i - 1]);
    bandCache = { fetchedAt: now, bands: strictlyIncreasing ? bands : [...STATIC_BANDS] };
    return bandCache.bands;
  } catch {
    // sodaGet already logged the upstream failure; degrade quietly.
    return [...STATIC_BANDS];
  }
}

function bucketRisk(rate: number | null, bands: number[]): 1 | 2 | 3 | 4 | 5 {
  if (rate == null) return 3;
  let level = 1;
  for (const b of bands) if (rate >= b) level += 1;
  return Math.min(level, 5) as 1 | 2 | 3 | 4 | 5;
}

async function sodaGet(query: Record<string, string>): Promise<SodaRow[]> {
  const url = new URL(`${env.SANDAG_SOCRATA_BASE}/resource/${env.SANDAG_CRIME_RATES_RESOURCE_ID}.json`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.SANDAG_SOCRATA_APP_TOKEN) headers["X-App-Token"] = env.SANDAG_SOCRATA_APP_TOKEN;
  try {
    const res = await fetchWithRetry(url, { headers, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`SANDAG SODA ${res.status}: ${await res.text()}`);
    return (await readJson(res)) as SodaRow[];
  } catch (err) {
    // Surface SANDAG upstream issues in deploy logs — matches the warn
    // pattern in every other adapter so we never silently swallow failures.
    console.warn("[sandag] fetch failed:", (err as Error).message);
    throw err;
  }
}

export const sandagSocrataAdapter: CrimeDataAdapter = {
  name: "sandag-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    // fix(audit pentest-inj-1): never interpolate the raw user-supplied `area`
    // into the SoQL $where. An unrecognized area has no SANDAG jurisdiction, so
    // when findArea() misses we return null instead of falling back to the raw
    // string. The remaining value is the registry-controlled jurisdiction (still
    // SoQL-escaped defensively), not user input.
    const known = findArea(area);
    if (!known) return null;
    const jurisdiction = known.jurisdiction;

    const rows = await sodaGet({
      $where: `jurisdiction='${jurisdiction.replace(/'/g, "''")}'`,
      $order: "year DESC",
      $limit: "1",
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    const crimeRate = r.crime_rate != null ? Number(r.crime_rate) : null;
    const bands = await getRegionalBands();
    return {
      area: known?.label ?? jurisdiction,
      crimeRate,
      violentCrimeRate: r.violent_crime_rate != null ? Number(r.violent_crime_rate) : null,
      propertyCrimeRate: r.property_crime_rate != null ? Number(r.property_crime_rate) : null,
      riskLevel: bucketRisk(crimeRate, bands),
      year: r.year != null ? Number(r.year) : undefined,
      provenance: PROVENANCE,
    };
  },

  async getIncidents(): Promise<Incident[]> {
    return [];
  },

  async getRecentReports(): Promise<Incident[]> {
    return [];
  },
};
