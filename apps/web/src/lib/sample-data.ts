// Client-side sample data used when the API is unreachable. Every shape here
// matches the corresponding API response so components don't need fallback
// branches. When this kicks in, the api-client surfaces a "demo data" flag
// the layout reads to show the SampleDataBanner — we never silently pass
// off sample data as real.

const NOW = Date.now();
const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const mins = (n: number) => new Date(NOW - n * 60_000).toISOString();

const PROVENANCE = {
  source: "TravelSafe demo data (offline / API unreachable)",
  datasetUrl: "about:blank",
  recency: "Bundled with the web app for offline preview",
  granularity: "neighborhood" as const,
  disclaimer:
    "The TravelSafe API isn't reachable from this browser, so the UI is showing bundled demo data. " +
    "Set NEXT_PUBLIC_API_BASE_URL on Vercel + ensure the Railway API is live to see real San Diego data.",
};

export const SAMPLE_AREAS = [
  { slug: "pacific-beach",  label: "Pacific Beach",   jurisdiction: "San Diego", centroid: { lat: 32.7997, lng: -117.2358 } },
  { slug: "hillcrest",      label: "Hillcrest",       jurisdiction: "San Diego", centroid: { lat: 32.7484, lng: -117.1641 } },
  { slug: "downtown-sd",    label: "Downtown",        jurisdiction: "San Diego", centroid: { lat: 32.7157, lng: -117.1611 } },
  { slug: "la-jolla",       label: "La Jolla",        jurisdiction: "San Diego", centroid: { lat: 32.8328, lng: -117.2713 } },
  { slug: "mission-valley", label: "Mission Valley",  jurisdiction: "San Diego", centroid: { lat: 32.7707, lng: -117.1521 } },
  { slug: "mira-mesa",      label: "Mira Mesa",       jurisdiction: "San Diego", centroid: { lat: 32.9170, lng: -117.1450 } },
  { slug: "north-park",     label: "North Park",      jurisdiction: "San Diego", centroid: { lat: 32.7396, lng: -117.1294 } },
];

const PER_AREA_DEMO = [
  { slug: "pacific-beach",  incidentCount: 187, riskLevel: 3 as const },
  { slug: "downtown-sd",    incidentCount: 264, riskLevel: 4 as const },
  { slug: "hillcrest",      incidentCount: 142, riskLevel: 3 as const },
  { slug: "north-park",     incidentCount: 121, riskLevel: 3 as const },
  { slug: "mission-valley", incidentCount: 98,  riskLevel: 2 as const },
  { slug: "mira-mesa",      incidentCount: 67,  riskLevel: 2 as const },
  { slug: "la-jolla",       incidentCount: 41,  riskLevel: 1 as const },
];

const SAMPLE_CITYWIDE = {
  totalIncidents: PER_AREA_DEMO.reduce((s, p) => s + p.incidentCount, 0),
  alerts: [
    { area: "City of San Diego", category: "PROPERTY", riskLevel: 4 as const, summary: "612 property incidents reported across SD neighborhoods in the cached window.", recency: "Quarterly refresh", provenance: PROVENANCE },
    { area: "City of San Diego", category: "PERSONS",  riskLevel: 3 as const, summary: "188 incidents against persons reported across SD neighborhoods in the cached window.", recency: "Quarterly refresh", provenance: PROVENANCE },
    { area: "City of San Diego", category: "SOCIETY",  riskLevel: 2 as const, summary: "120 society-category incidents reported across SD neighborhoods in the cached window.", recency: "Quarterly refresh", provenance: PROVENANCE },
  ],
  perArea: PER_AREA_DEMO.map((p) => {
    const a = SAMPLE_AREAS.find((x) => x.slug === p.slug)!;
    return { slug: a.slug, label: a.label, incidentCount: p.incidentCount, riskLevel: p.riskLevel };
  }),
};

function weeklyPattern(seed: number, length = 12, peak = 12): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const wobble = Math.sin((i + seed) * 0.7) * 0.4 + Math.cos((i + seed) * 0.3) * 0.3;
    out.push(Math.max(0, Math.round((1 + wobble) * (peak / 2))));
  }
  return out;
}

const SAMPLE_INSIGHTS_BY_AREA: Record<string, unknown> = {};
for (const a of SAMPLE_AREAS) {
  const persons  = weeklyPattern(a.slug.length,      12, 5);
  const property = weeklyPattern(a.slug.length + 3,  12, 14);
  const society  = weeklyPattern(a.slug.length + 7,  12, 7);
  const total = persons.concat(property, society).reduce((s, n) => s + n, 0);
  SAMPLE_INSIGHTS_BY_AREA[a.slug] = {
    area: a.label,
    windowWeeks: 12,
    totalIncidents: total,
    trends: [
      { category: "PROPERTY", weekly: property, baseline: property.slice(0, -1).reduce((s, n) => s + n, 0) / 11, currentVsBaseline: 0.18 },
      { category: "PERSONS",  weekly: persons,  baseline: persons.slice(0, -1).reduce((s, n) => s + n, 0) / 11,  currentVsBaseline: -0.05 },
      { category: "SOCIETY",  weekly: society,  baseline: society.slice(0, -1).reduce((s, n) => s + n, 0) / 11,  currentVsBaseline: 0.32 },
    ],
    brief: `${a.label} has been close to its baseline this week. Society-category reports are running modestly above baseline; context: single-week upticks are common in any neighborhood and don't by themselves indicate a trend.`,
  };
}

const SAMPLE_CITYWIDE_INSIGHTS = {
  area: "City of San Diego",
  windowWeeks: 12,
  totalIncidents: 920,
  trends: [
    { category: "PROPERTY", weekly: weeklyPattern(1, 12, 60), baseline: 55,  currentVsBaseline: 0.08 },
    { category: "PERSONS",  weekly: weeklyPattern(2, 12, 18), baseline: 16,  currentVsBaseline: -0.04 },
    { category: "SOCIETY",  weekly: weeklyPattern(3, 12, 12), baseline: 10,  currentVsBaseline: 0.14 },
  ],
  brief: "San Diego as a whole is tracking close to its long-term baseline. Property reports have edged up modestly; persons and society categories are within typical bounds.",
};

const SAMPLE_POSTS = [
  { id: "demo-1", areaSlug: "pacific-beach",  kind: "SAFETY_NOTICE", body: "What: Increased reports of bike thefts near the boardwalk after dark. Multiple residents have mentioned this in the last week.\nWhere: Boardwalk between Crystal Pier and Belmont Park\nWhen: Late evenings, past two weeks", reviewedAt: days(1), createdAt: days(1) },
  { id: "demo-2", areaSlug: "pacific-beach",  kind: "AREA_HAZARD",   body: "What: Sidewalk badly cracked along the seawall; people on scooters keep almost wiping out at dusk.\nWhere: Seawall walkway near Diamond Street\nWhen: Ongoing", reviewedAt: days(3), createdAt: days(3) },
  { id: "demo-3", areaSlug: "downtown-sd",    kind: "HEADS_UP",      body: "What: Aggressive panhandling pattern with someone approaching diners through outdoor seating and refusing to leave when asked.\nWhere: Gaslamp Quarter restaurant patios\nWhen: This weekend, evenings", reviewedAt: days(2), createdAt: days(2) },
  { id: "demo-4", areaSlug: "hillcrest",      kind: "LOST_FOUND",    body: "What: Found a small black mixed-breed dog wandering near the Pride flag. Friendly, has a collar but no tag.\nWhere: Pride flag plaza on University\nWhen: Sunday morning", reviewedAt: days(0), createdAt: days(0) },
  { id: "demo-5", areaSlug: "north-park",     kind: "AREA_HAZARD",   body: "What: Streetlight out for most of the block, very dark even by 7pm.\nWhere: 30th Street north of University Ave\nWhen: Past 4-5 days", reviewedAt: days(4), createdAt: days(4) },
  { id: "demo-6", areaSlug: "mission-valley", kind: "SAFETY_NOTICE", body: "What: Increase in car break-ins reported in the mall parking lots after sunset. Lock valuables out of sight.\nWhere: Westfield Mission Valley parking structures\nWhen: Past two weeks", reviewedAt: days(2), createdAt: days(2) },
  { id: "demo-7", areaSlug: "la-jolla",       kind: "HEADS_UP",      body: "What: Coyote sightings on residential streets after dusk; keep small pets indoors at night.\nWhere: Streets above the Cove\nWhen: This week, after dusk", reviewedAt: days(1), createdAt: days(1) },
  { id: "demo-8", areaSlug: "mira-mesa",      kind: "AREA_HAZARD",   body: "What: Construction has narrowed the bike lane and pushed cyclists into traffic with no signage.\nWhere: Mira Mesa Blvd near Camino Ruiz\nWhen: Past week, ongoing", reviewedAt: days(2), createdAt: days(2) },
];

function postCard(p: typeof SAMPLE_POSTS[number]) {
  const area = SAMPLE_AREAS.find((a) => a.slug === p.areaSlug)!;
  return {
    id: p.id,
    body: p.body,
    kind: p.kind,
    status: "VERIFIED",
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt,
    area: { id: area.slug, name: area.label, slug: area.slug },
    author: { id: "demo", displayName: "TravelSafe Team (sample)" },
    reactions: [],
    _count: { comments: 0, reactions: 0, reports: 0 },
  };
}

const SAMPLE_AREA_STATS: Record<string, unknown> = {
  "san-diego": { area: "San Diego", crimeRate: 24.6, violentCrimeRate: 3.1, propertyCrimeRate: 21.5, riskLevel: 3, year: 2022, provenance: PROVENANCE },
};
for (const a of SAMPLE_AREAS) {
  SAMPLE_AREA_STATS[a.slug] = { area: a.label, crimeRate: 22 + Math.random() * 10, violentCrimeRate: 2 + Math.random() * 2, propertyCrimeRate: 19 + Math.random() * 8, riskLevel: PER_AREA_DEMO.find((p) => p.slug === a.slug)?.riskLevel ?? 2, year: 2022, provenance: PROVENANCE };
}

const SAMPLE_NEIGHBORHOOD_FEED: Record<string, unknown> = {};
for (const a of SAMPLE_AREAS) {
  const posts = SAMPLE_POSTS.filter((p) => p.areaSlug === a.slug).map(postCard);
  SAMPLE_NEIGHBORHOOD_FEED[a.slug] = {
    area: { id: a.slug, name: a.label, slug: a.slug },
    posts,
    alerts: [
      { area: a.label, category: "PROPERTY", riskLevel: 3, summary: `Sample: ${a.label} is currently around its property-crime baseline.`, recency: "Demo data", provenance: PROVENANCE },
    ],
    recent: [
      { id: `${a.slug}-r1`, ibrOffenseDescription: "Theft from vehicle (sample)", occurredAt: days(1), beat: "DEMO" },
      { id: `${a.slug}-r2`, ibrOffenseDescription: "Burglary - residential (sample)", occurredAt: days(3), beat: "DEMO" },
      { id: `${a.slug}-r3`, ibrOffenseDescription: "Simple assault (sample)", occurredAt: days(5), beat: "DEMO" },
    ],
  };
}

const SAMPLE_OFFICIAL = {
  sources: ["Demo / National Weather Service shape"],
  alerts: [
    { id: "demo-alert-1", source: "National Weather Service (sample)", category: "Met", severity: "Moderate", headline: "High Surf Advisory in effect for San Diego County coast", description: "Sample alert.", effective: mins(45), expires: mins(-720), url: "about:blank" },
    { id: "demo-alert-2", source: "National Weather Service (sample)", category: "Met", severity: "Minor",    headline: "Beach Hazards Statement — rip currents",            description: "Sample alert.", effective: mins(120), expires: mins(-360), url: "about:blank" },
  ],
  disclaimer: "Sample alerts — when the API is reachable, this panel pulls real NWS alerts for the San Diego region.",
};

// Route a request path to a sample-data payload. Returns `undefined` for
// paths we don't bundle samples for (e.g. auth, write actions) — those still
// surface their original error so the user knows to sign in or fix the API.
export function sampleFor(path: string): unknown | undefined {
  if (path === "/community/posts" || path.startsWith("/community/posts?")) {
    const u = new URL(path, "http://placeholder.local");
    const area = u.searchParams.get("area");
    return area
      ? SAMPLE_POSTS.filter((p) => p.areaSlug === area).map(postCard)
      : SAMPLE_POSTS.slice(0, 6).map(postCard);
  }
  if (path === "/crime-data/citywide") return SAMPLE_CITYWIDE;
  if (path.startsWith("/crime-data/insights")) {
    const u = new URL(path, "http://placeholder.local");
    const n = u.searchParams.get("neighborhood");
    if (n && SAMPLE_INSIGHTS_BY_AREA[n]) return SAMPLE_INSIGHTS_BY_AREA[n];
    return SAMPLE_CITYWIDE_INSIGHTS;
  }
  if (path.startsWith("/crime-data/area-stats")) {
    const u = new URL(path, "http://placeholder.local");
    const n = u.searchParams.get("neighborhood") ?? u.searchParams.get("jurisdiction") ?? "san-diego";
    return SAMPLE_AREA_STATS[n] ?? SAMPLE_AREA_STATS["san-diego"];
  }
  if (path.startsWith("/crime-data/alerts")) {
    const u = new URL(path, "http://placeholder.local");
    const area = u.searchParams.get("neighborhood") ?? "san-diego";
    return { area, alerts: SAMPLE_CITYWIDE.alerts };
  }
  if (path.startsWith("/crime-data/recent")) {
    const u = new URL(path, "http://placeholder.local");
    const n = u.searchParams.get("neighborhood") ?? "pacific-beach";
    return (SAMPLE_NEIGHBORHOOD_FEED[n] as { recent: unknown }).recent;
  }
  if (path.startsWith("/neighborhood/feed")) {
    const u = new URL(path, "http://placeholder.local");
    const n = u.searchParams.get("neighborhood") ?? "pacific-beach";
    return SAMPLE_NEIGHBORHOOD_FEED[n] ?? SAMPLE_NEIGHBORHOOD_FEED["pacific-beach"];
  }
  if (path === "/neighborhood/" || path === "/neighborhood") {
    return SAMPLE_AREAS.map((a) => ({ id: a.slug, slug: a.slug, name: a.label, kind: "NEIGHBORHOOD" }));
  }
  if (path === "/geo/areas") return SAMPLE_AREAS;
  if (path === "/official-alerts") return SAMPLE_OFFICIAL;
  return undefined;
}
