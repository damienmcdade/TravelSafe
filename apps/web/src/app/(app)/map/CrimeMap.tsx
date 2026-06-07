"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, GeoJSON, Tooltip, CircleMarker, useMap } from "react-leaflet";
import type { Layer, LeafletMouseEvent, PathOptions } from "leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "leaflet/dist/leaflet.css";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { displayOffenseLabel } from "@/lib/offense-labels";

// Module-level polygon cache shared across remounts of CrimeMap. Wiping
// when the user reloads the page is fine; everything that matters lives
// on the CDN and re-fetches in ~tens of ms anyway.
const POLYGON_CACHE = new Map<string, FeatureCollection>();

interface KnownArea { slug: string; label: string; jurisdiction: string; centroid: { lat: number; lng: number } }
interface AreaBreakdown {
  slug: string;
  label: string;
  incidentCount: number;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number };
  dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null;
}
interface TopOffense { offense: string; count: number }
interface Citywide { city: string; totalIncidents: number; appliedOffense: string | null; topOffenses: TopOffense[]; perArea: AreaBreakdown[] }
interface RecentIncident { id: string; nibrsCategory: "PERSONS" | "PROPERTY" | "SOCIETY"; ibrOffenseDescription: string; occurredAt: string; lat?: number; lng?: number; blockLabel?: string }
interface RecentResp { area: string; reports: RecentIncident[] }

// Three high-saturation category colors from completely different hue
// families. Red / amber / blue maximally distinct on the color wheel,
// each pure enough that the color-blend in fuseColor() produces
// recognizable orange-red, magenta-ish, and indigo-amber tones for
// mixed-category neighborhoods. Deliberate lightness offsets keep them
// distinguishable under deuteranopia/protanopia colorblindness.
// RGB and hex MUST stay in sync — the blend math reads the rgb tuple,
// the legend/swatch reads the hex.
const CATEGORY_COLOR = {
  PERSONS:  { rgb: [220,  38,  38], label: "Violent (persons)", hex: "#DC2626" },
  PROPERTY: { rgb: [245, 158,  11], label: "Property",          hex: "#F59E0B" },
  SOCIETY:  { rgb: [ 37,  99, 235], label: "Society / other",   hex: "#2563EB" },
} as const;
const NO_DATA_RGB = [210, 213, 219] as const;
type Cat = keyof typeof CATEGORY_COLOR;

// Known spelling variants between the official polygon files and what the
// police department prints in their NIBRS column. Both sides get normalized
// through this table before fuzzy-matching kicks in. Each entry is two
// names that should be treated as identical.
//
// v77 — expanded after the pre-rollout map-data audit. Each cluster of
// aliases corresponds to a city whose polygon GeoJSON labels diverged
// from the adapter's published area names (typographic, abbreviation,
// or punctuation drift). Adding both directions keeps the fuzzy fallback
// from accidentally matching the wrong neighborhood.
const NAME_ALIASES: Array<[string, string]> = [
  // San Diego — polygon vs SDPD column spellings.
  ["fairmount", "fairmont"],
  ["tierra santa", "tierrasanta"],
  ["kearney mesa", "kearny mesa"],
  ["ofarrell", "o farrell"],
  ["mt hope", "mount hope"],
  ["la jolla", "lajolla"],
  ["la playa", "laplaya"],
  // Denver — the Stapleton neighborhood was officially renamed "Central Park"
  // in 2020 after community vote. The polygon file still says Stapleton; the
  // adapter receives "central-park" from Denver Open Data.
  ["stapleton", "central park"],
  // Detroit — typo in the source polygon file (Melvern vs Malvern).
  ["malvern hill", "melvern hill"],
  // Detroit — punctuation drift between "/" and " "
  ["gratiot town ketterring", "gratiot town kettering"],
  // (Removed v82) LA — "central" → "central la" caused cascade
  // ("central la" includes "central" → "central la la") and the
  // adapter doesn't currently emit a "Central" division anyway.
  // The v82 polygon filter drops orphan polygons automatically.
  // Pittsburgh — period in "Mt. Oliver" vs full "Mount Oliver".
  ["mt oliver", "mount oliver"],
  // Cincinnati — "Central Business District" vs "CBD/Riverfront"
  ["central business district", "cbd riverfront"],
  ["columbia tusculum", "columbiatusculum"],
  // SF — "Downtown/Civic Center" punctuation
  ["downtown civic center", "downtowncivic center"],
  // New Orleans — polygon source uses "Florida Dev" for Florida Development.
  ["florida dev", "florida development"],
];

function normName(s: string): string {
  let out = s.toLowerCase()
    .replace(/[\/_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    // Collapse common city-name abbreviations so polygon "West Los Angeles"
    // matches our area label "West LA", "San Francisco Tenderloin" matches
    // "SF Tenderloin", etc. Both sides of the compare get the same treatment.
    .replace(/\blos angeles\b/g, "la")
    .replace(/\bsan francisco\b/g, "sf")
    .replace(/\bsan diego\b/g, "sd")
    .replace(/\bchicago\b/g, "chi")
    .replace(/\bnew york\b/g, "ny")
    .replace(/\bseattle\b/g, "sea")
    .replace(/\bcolorado springs\b/g, "cosp")
    .replace(/\bdetroit\b/g, "det")
    // v78 — strip the conjunction "and" so Norfolk's polygon-file
    // "Azalea Acres and Azalea Lakes" matches its adapter label
    // "Azalea Acres/ Azalea Lakes" (the "/" gets normalized to a
    // space, leaving the "and" as the only material difference).
    // Applies after city-abbrev rules but before whitespace collapse.
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [a, b] of NAME_ALIASES) {
    if (out.includes(a)) out = out.replaceAll(a, b);
  }
  return out;
}

/// Blend the three category colors weighted by the share of each category in
/// the neighborhood's total. Output saturation scales with how many incidents
/// the area saw vs the city-wide max — so a sleepy area is pale, a busy area
/// is vivid, regardless of which category dominates.
///
/// Opacity curve uses sqrt() so the difference between "few incidents" and
/// "many incidents" reads even when the citywide max is dominated by a single
/// outlier neighborhood. Floor lifted from 0.25 → 0.55 in March because
/// users reported the previous palette read as washed-out.
function fuseColor(
  breakdown: AreaBreakdown | null,
  value: number,
  maxValue: number,
): { fill: string; opacity: number; stroke: string } {
  if (!breakdown || breakdown.incidentCount === 0 || value <= 0) {
    return { fill: `rgb(${NO_DATA_RGB.join(",")})`, opacity: 0.22, stroke: "#94a3b8" };
  }
  const total = breakdown.byCategory.PERSONS + breakdown.byCategory.PROPERTY + breakdown.byCategory.SOCIETY || 1;
  const w: Record<Cat, number> = {
    PERSONS:  breakdown.byCategory.PERSONS  / total,
    PROPERTY: breakdown.byCategory.PROPERTY / total,
    SOCIETY:  breakdown.byCategory.SOCIETY  / total,
  };
  const r = Math.round(w.PERSONS * CATEGORY_COLOR.PERSONS.rgb[0]  + w.PROPERTY * CATEGORY_COLOR.PROPERTY.rgb[0]  + w.SOCIETY * CATEGORY_COLOR.SOCIETY.rgb[0]);
  const g = Math.round(w.PERSONS * CATEGORY_COLOR.PERSONS.rgb[1]  + w.PROPERTY * CATEGORY_COLOR.PROPERTY.rgb[1]  + w.SOCIETY * CATEGORY_COLOR.SOCIETY.rgb[1]);
  const b = Math.round(w.PERSONS * CATEGORY_COLOR.PERSONS.rgb[2]  + w.PROPERTY * CATEGORY_COLOR.PROPERTY.rgb[2]  + w.SOCIETY * CATEGORY_COLOR.SOCIETY.rgb[2]);
  const ratio = Math.min(1, value / Math.max(1, maxValue));
  // v51 — bumped opacity floor 0.42 → 0.55 and ceiling 0.82 → 0.95
  // after a user reported "crime maps for some cities such as New
  // Orleans will not populate coloring scheme." NOLA's top
  // neighborhood has ~520 incidents in the cached window — much
  // sparser than Chicago / Detroit which can hit 5k+. Under the old
  // floor every mid-density NOLA polygon landed near 0.5 opacity
  // against a grey-blue background, which read as "no color." The
  // brighter floor (0.55) plus a higher ceiling guarantees visible
  // shading even when the citywide maxValue is small.
  const opacity = 0.55 + Math.cbrt(ratio) * 0.40;
  return { fill: `rgb(${r},${g},${b})`, opacity, stroke: `rgb(${Math.max(0, r - 50)},${Math.max(0, g - 50)},${Math.max(0, b - 50)})` };
}

/// Compute approximate area in km² for every polygon in a city's
/// GeoJSON. Equirectangular projection anchored on each polygon's mean
/// latitude + shoelace formula — same logic as server/lib/polygon-areas.ts
/// but inlined here so the map shading can render without a network
/// round-trip. Accurate to within a few percent for neighborhood-scale
/// polygons; that's enough for density-based ordering of polygons.
function computePolygonAreasKm2(fc: FeatureCollection | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!fc) return out;
  for (const feat of fc.features) {
    const name = (feat.properties as { name?: string } | null)?.name;
    if (!name) continue;
    let area = 0;
    if (feat.geometry?.type === "Polygon") {
      area = ringsAreaKm2((feat.geometry as { coordinates: number[][][] }).coordinates);
    } else if (feat.geometry?.type === "MultiPolygon") {
      for (const poly of (feat.geometry as { coordinates: number[][][][] }).coordinates) {
        area += ringsAreaKm2(poly);
      }
    }
    if (area > 0) out.set(name, area);
  }
  return out;
}

function ringsAreaKm2(rings: number[][][]): number {
  let totalLat = 0, count = 0;
  for (const ring of rings) for (const p of ring) { totalLat += p[1]; count++; }
  if (count === 0) return 0;
  const meanLat = totalLat / count;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.320 * Math.cos((meanLat * Math.PI) / 180);
  let total = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (ring.length < 3) continue;
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0] * kmPerDegLon;
      const yi = ring[i][1] * kmPerDegLat;
      const xj = ring[j][0] * kmPerDegLon;
      const yj = ring[j][1] * kmPerDegLat;
      sum += xj * yi - xi * yj;
    }
    const ringArea = Math.abs(sum) / 2;
    total += r === 0 ? ringArea : -ringArea;
  }
  return Math.max(0, total);
}

/// Richer hover tooltip HTML. Bold name, large total, colored category
/// rows aligned to the same palette the polygon shading uses, and a
/// click-affordance footer. Built as a single HTML string because
/// react-leaflet's bindTooltip takes plain markup and we don't have a
/// React tree inside the Leaflet layer.
function tooltipHtml(name: string, stats: AreaBreakdown | null): string {
  const safeName = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!stats || stats.incidentCount === 0) {
    return (
      `<div style="font-family:inherit;min-width:160px">` +
      `<div style="font-weight:600;color:#1C232C;font-size:0.875rem">${safeName}</div>` +
      `<div style="font-size:0.75rem;color:#94a3b8;margin-top:2px">No recent reports — typical for many quiet areas.</div>` +
      `<div style="font-size:0.65rem;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">Click to view detail</div>` +
      `</div>`
    );
  }
  const rows = (["PERSONS", "PROPERTY", "SOCIETY"] as Cat[])
    .map((k) => {
      const n = stats.byCategory[k];
      if (n === 0) return "";
      const c = CATEGORY_COLOR[k];
      return (
        `<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#334155;margin-top:2px">` +
        `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.hex}"></span>` +
        `<span style="flex:1">${c.label}</span>` +
        `<span style="font-variant-numeric:tabular-nums;color:#0F172A;font-weight:500">${n.toLocaleString()}</span>` +
        `</div>`
      );
    })
    .filter(Boolean)
    .join("");
  return (
    `<div style="font-family:inherit;min-width:200px">` +
    `<div style="font-weight:600;color:#1C232C;font-size:0.875rem">${safeName}</div>` +
    `<div style="display:flex;align-items:baseline;gap:4px;margin-top:1px">` +
    `<span style="font-size:1.125rem;font-weight:600;color:#0F172A;font-variant-numeric:tabular-nums">${stats.incidentCount.toLocaleString()}</span>` +
    `<span style="font-size:0.7rem;color:#64748b">recent reports</span>` +
    `</div>` +
    `<div style="margin-top:4px">${rows}</div>` +
    `<div style="font-size:0.65rem;color:#94a3b8;margin-top:6px;text-transform:uppercase;letter-spacing:0.05em">Click to view detail</div>` +
    `</div>`
  );
}

export default function CrimeMap() {
  const { city } = useCity();

  // Static polygon file is one of the small GeoJSONs in /public/geo/. We
  // cache the parsed FeatureCollection per city in module memory so panning,
  // zooming, or returning to a city we just visited doesn't trigger another
  // HTTP fetch + JSON parse. Vercel serves these as immutable CDN assets, so
  // a memory cache is purely an arrived-once-stays-fast win.
  const [polygons, setPolygons] = useState<FeatureCollection | null>(() => POLYGON_CACHE.get(city.slug) ?? null);
  const [polyError, setPolyError] = useState<string | null>(null);
  useEffect(() => {
    const cached = POLYGON_CACHE.get(city.slug);
    if (cached) { setPolygons(cached); setPolyError(null); return; }
    setPolygons(null); setPolyError(null);
    let cancelled = false;
    // Capture the city we started fetching so the resolved response can't
    // overwrite the cache or state for a different city if the user
    // rapid-switches before the response lands. Each effect closure has its
    // own `startedSlug` snapshot.
    const startedSlug = city.slug;
    fetch(`/geo/${startedSlug}.geojson`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((d: FeatureCollection) => {
        // Only cache and set if THIS effect's slug still matches what's
        // mounted. A stale response from a prior city can't poison the
        // cache for a city it didn't originate from.
        if (cancelled) return;
        POLYGON_CACHE.set(startedSlug, d);
        setPolygons(d);
      })
      .catch((e) => { if (!cancelled) setPolyError(`Could not load ${city.label} neighborhood boundaries (${(e as Error).message}).`); });
    return () => { cancelled = true; };
  }, [city.slug, city.label]);

  // v77 — was calling `/geo/areas` (no filter) which returns ONLY
  // the legacy 7 SD areas. For any city other than San Diego, the
  // downstream jurisdiction filter returned [], no polygon could
  // resolve to an adapter slug, and every polygon rendered as
  // "no data" gray with no warning. Pre-rollout map audit caught
  // this: 0% polygon match rate for ~25 cities. Switching to the
  // city-scoped endpoint returns the right neighborhood set per city.
  const areasPath = `/geo/areas?city=${city.slug}`;
  const { data: areasResp } = useApi<{ areas: KnownArea[] } | KnownArea[]>(areasPath, [areasPath]);
  const areas = useMemo(
    () => (Array.isArray(areasResp) ? areasResp : areasResp?.areas) ?? null,
    [areasResp],
  );
  const path = `/crime-data/citywide?city=${city.slug}`;
  const { data: citywide, loading: cityLoading, error: cityErr } = useApi<Citywide>(path, [path]);

  // Match polygon name → our area slug via fuzzy normalized comparison.
  // Returns BOTH a stats lookup and a slug lookup so polygon clicks can
  // sync the global area selection (used by /safety-score, /trends, etc.)
  // and the "View safety details" CTA can deep-link by slug.
  const { polygonStats, polygonSlugByName } = useMemo(() => {
    const stats = new Map<string, AreaBreakdown | null>();
    const slugByName = new Map<string, string>();
    if (!polygons) return { polygonStats: stats, polygonSlugByName: slugByName };
    // City-scoped endpoint already returns only the right city's areas,
    // but keep the jurisdiction belt+suspenders so a future schema
    // change can't silently break this match.
    const cityAreas = (areas ?? []).filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase());
    const byNormLabel = new Map(cityAreas.map((a) => [normName(a.label), a.slug]));
    const statsBySlug = new Map((citywide?.perArea ?? []).map((p) => [p.slug, p]));
    for (const feat of polygons.features) {
      const polyName = (feat.properties as { name?: string } | null)?.name ?? "";
      const norm = normName(polyName);
      // Exact match first, then a constrained fuzzy fallback.
      let slug = byNormLabel.get(norm);
      if (!slug) {
        // fix(audit map-balt-substring-misbind): the old "first substring match
        // wins" fallback mis-bound stats — polygon "Carroll" matched whichever of
        // "Carroll Park" / "Carroll-Camden" the Map iterated first, and a raw
        // substring could even bind "Carroll" → "Carrollton". Match on WORD-SET
        // containment (every token of the shorter name is a WHOLE word of the
        // longer) and bind only when EXACTLY ONE area qualifies; zero or multiple
        // distinct matches → leave unmatched (honest blank) rather than guess.
        const polyWords = norm.split(" ").filter(Boolean);
        const matched = new Set<string>();
        for (const [labelNorm, s] of byNormLabel) {
          if (labelNorm === norm) continue;
          const labelWords = labelNorm.split(" ").filter(Boolean);
          const polyInLabel = polyWords.length > 0 && polyWords.every((w) => labelWords.includes(w));
          const labelInPoly = labelWords.length > 0 && labelWords.every((w) => polyWords.includes(w));
          if (polyInLabel || labelInPoly) matched.add(s);
        }
        if (matched.size === 1) slug = [...matched][0];
      }
      stats.set(polyName, slug ? (statsBySlug.get(slug) ?? null) : null);
      if (slug) slugByName.set(polyName, slug);
    }
    return { polygonStats: stats, polygonSlugByName: slugByName };
  }, [polygons, areas, citywide, city.label]);

  // v82 — filter the rendered polygon set to those that resolve to
  // an adapter slug. Pre-v82, cities whose polygon files had more
  // features than the adapter publishes (Milwaukee: 190 polys / 27
  // areas, Philly: 159 polys / 21 areas, LA: 21 polys / 18 areas)
  // rendered the orphan polygons in solid gray "no data" — visually
  // dominating the map and hiding the meaningful colored polygons.
  // Drop the orphans entirely so the map only shows neighborhoods
  // we can actually surface stats for. Adapter areas with 0 in-window
  // incidents still keep their polygon (statsBySlug.get returns an
  // entry with incidentCount=0; shaded pale per the existing scale).
  const polygonsForRender = useMemo(() => {
    if (!polygons) return polygons;
    if (polygonSlugByName.size === 0) return polygons;  // adapter not loaded yet — render all
    const filtered = polygons.features.filter((f) => {
      const name = (f.properties as { name?: string } | null)?.name ?? "";
      return polygonSlugByName.has(name);
    });
    return { ...polygons, features: filtered };
  }, [polygons, polygonSlugByName]);

  // v102 — adapter areas with NO matching polygon: neighborhoods the source
  // agency never published a boundary for, plus the "Unmapped" bucket of
  // incidents that fell outside every neighborhood polygon. They can't be
  // drawn on the choropleth, so we list them in a footnote under the map
  // (they remain searchable + in the data cards) rather than silently
  // dropping them — honest about what the boundary data does and doesn't cover.
  const unmappedAreas = useMemo(() => {
    if (!areas || polygonSlugByName.size === 0) return [];
    const covered = new Set(polygonSlugByName.values());
    return areas
      .filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase() && !covered.has(a.slug))
      .map((a) => a.label)
      .sort((a, b) => (a === "Unmapped" ? 1 : b === "Unmapped" ? -1 : a.localeCompare(b)));
  }, [areas, polygonSlugByName, city.label]);

  // v83 — POLYGON-SYNC: orphan adapter areas (areas that have data
  // but no matching polygon in the city's GeoJSON file) get a
  // synthetic CircleMarker rendered at the adapter's published
  // centroid. This guarantees no drop in service: every neighborhood
  // the adapter knows about appears on the map, even when the
  // polygon file is incomplete or stale. The marker is styled
  // differently from real polygons (translucent + dashed) so users
  // can tell at a glance which areas have proper boundaries vs
  // centroid-only approximations. Circles scale by incident count
  // using the same maxCount denominator as polygon shading.
  // v98 — orphan centroid-circle fallback removed per product direction:
  // the crime map renders ONLY the full neighborhood-polygon choropleth
  // (block coloring). Areas that have data but no matching polygon are
  // still reachable via the dropdown picker and flagged by the
  // polygon-mismatch banner below — they are no longer drawn as circles.

  // v77 — detect "polygon file ↔ adapter areas" mismatch. Pre-rollout
  // audit caught Phoenix + Milwaukee using ZIP-code polygons (85003,
  // 53202, …) while the adapters return neighborhood names (Maryvale,
  // Sherman Park, …). Every polygon ended up rendering as "no data"
  // gray with no explanation. When fewer than 25% of the SOURCE
  // polygons match ANY area, show a banner pointing users at the
  // dropdown picker (which uses the adapter areas directly and works
  // regardless). Threshold reads from the unfiltered set so v82's
  // filter doesn't suppress the banner when needed.
  const polygonMatchRate = useMemo(() => {
    if (!polygons || polygons.features.length === 0) return 1;
    let matched = 0;
    for (const stats of polygonStats.values()) if (stats) matched++;
    return matched / polygons.features.length;
  }, [polygons, polygonStats]);
  const polygonMismatch = polygons && polygons.features.length > 0 && polygonMatchRate < 0.25 && citywide && (citywide.perArea?.length ?? 0) > 0;

  // Polygon areas in km² for the density overlay. Computed once per
  // polygon load via the same shoelace formula the server uses
  // (lib/polygon-areas.ts) but inlined here so the map renders without
  // a network round-trip. See computePolygonAreasKm2 below.
  const polygonAreasKm2 = useMemo(() => computePolygonAreasKm2(polygons), [polygons]);

  // ---- View mode: count vs density -----------------------------------------
  // "count" shades polygons by raw incident count (the original mode).
  // "density" shades by incidents per km², which better surfaces small
  // high-activity neighborhoods whose absolute counts get out-shouted by
  // sprawling-but-quieter districts. Uses the polygon areas computed
  // client-side from the same GeoJSON the map already loaded.
  const [mapMode, setMapMode] = useState<"count" | "density">("count");

  // The "value" each polygon contributes for shading — count in count
  // mode, count/km² in density mode. maxValue normalizes the gradient.
  const polygonValues = useMemo(() => {
    const m = new Map<string, number>();
    for (const [name, stats] of polygonStats) {
      const count = stats?.incidentCount ?? 0;
      if (mapMode === "density") {
        const km2 = polygonAreasKm2.get(name) ?? 0;
        m.set(name, km2 > 0 ? count / km2 : 0);
      } else {
        m.set(name, count);
      }
    }
    return m;
  }, [polygonStats, polygonAreasKm2, mapMode]);
  const maxValue = useMemo(() => Math.max(1, ...Array.from(polygonValues.values())), [polygonValues]);
  // Back-compat alias for the rest of the file that still reads
  // `maxCount` — equivalent under count mode and produces the same
  // visual scale in density mode (values are already normalized).
  const maxCount = maxValue;

  // ---- Selection (autocomplete + zoom + drill-down) ------------------------
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // v108 audit (perf-map-geojson-key) — keep the <GeoJSON> layer ALIVE across
  // selection + data refresh. The React key used to include selectedName +
  // maxCount, so every polygon click and every 15-min refresh unmounted and
  // rebuilt all ~280 polygons (re-binding every tooltip). We now restyle/retip
  // imperatively: a ref to the layer (for tooltip refresh) and a ref mirroring
  // the live selection (so the construction-time onEachFeature mouseout reads
  // the CURRENT selection, not its stale closure value).
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const selectedNameRef = useRef<string | null>(null);
  useEffect(() => { selectedNameRef.current = selectedName; }, [selectedName]);
  // Refresh per-feature tooltip content in place when the incident stats change
  // (a background data refresh). bindTooltip runs only at layer construction, so
  // without this a refresh would show stale counts until the layer rebuilds.
  useEffect(() => {
    const g = geoJsonRef.current;
    if (!g) return;
    g.eachLayer((lyr) => {
      const f = (lyr as L.Layer & { feature?: Feature<Geometry> }).feature;
      const nm = (f?.properties as { name?: string } | null)?.name ?? "";
      (lyr as L.Layer).setTooltipContent?.(tooltipHtml(nm, polygonStats.get(nm) ?? null));
    });
  }, [polygonStats]);
  // Sync selection to the global area store so picking a polygon here also
  // updates /threats, /safety-score, /trends, etc. via useArea. Bidirectional:
  // a pick MADE elsewhere reflects on the map by highlighting the matching
  // polygon and zooming to it.
  const { area: globalArea, setArea } = useArea(city.slug);
  function pickPolygon(name: string | null) {
    setSelectedName(name);
    if (!name) { setArea(null); return; }
    const slug = polygonSlugByName.get(name);
    if (slug) setArea({ slug, label: name, jurisdiction: city.label });
  }
  const polygonNames = useMemo(
    () => (polygons?.features ?? []).map((f) => (f.properties as { name?: string } | null)?.name ?? "").filter(Boolean).sort(),
    [polygons],
  );
  // Inverse lookup so an incoming globalArea (slug-keyed) can resolve to
  // the polygon's display name and drive the map's local selection state.
  const polygonNameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const [n, s] of polygonSlugByName) m.set(s, n);
    return m;
  }, [polygonSlugByName]);
  const suggestions = useMemo(() => {
    if (!query) return [] as string[];
    const q = normName(query);
    return polygonNames.filter((n) => normName(n).includes(q)).slice(0, 8);
  }, [polygonNames, query]);

  useEffect(() => { setSelectedName(null); setQuery(""); }, [city.slug]);

  // Incoming sync: when the global area changes (picked in another tab or
  // restored from localStorage on first mount), highlight the matching
  // polygon. Skip when polygons haven't loaded yet so we don't no-op
  // away a user's pending pick.
  useEffect(() => {
    if (polygons == null) return;
    if (!globalArea) { setSelectedName(null); return; }
    const polyName = polygonNameBySlug.get(globalArea.slug);
    if (polyName && polyName !== selectedName) {
      setSelectedName(polyName);
      setQuery(polyName);
    }
    // selectedName intentionally omitted from deps — we only react to
    // globalArea / polygons changing, not to our own local state ping-pong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalArea?.slug, polygons, polygonNameBySlug]);

  // Recent incidents for the selected neighborhood — used to render per-offense
  // dots inside the polygon, and to power the drill-down legend.
  const selectedSlug = useMemo(() => {
    if (!selectedName) return null;
    const stats = polygonStats.get(selectedName);
    return stats?.slug ?? null;
  }, [selectedName, polygonStats]);
  const { data: recent } = useApi<RecentResp>(
    selectedSlug ? `/crime-data/recent?neighborhood=${encodeURIComponent(selectedSlug)}&limit=100` : null,
    [selectedSlug],
  );
  const selectedStats = selectedName ? polygonStats.get(selectedName) ?? null : null;

  // v85 — coverage badge for sync transparency. Counts what the map
  // is actually showing right now: matched polygons (real boundaries)
  // + orphan circles (centroid-only fallback). Users see "27
  // neighborhoods (15 boundaries + 12 approximate)" so they can
  // trust they're seeing all available data, regardless of polygon
  // file completeness.
  const matchedPolyCount = useMemo(() => {
    let n = 0;
    for (const stats of polygonStats.values()) if (stats && stats.incidentCount > 0) n++;
    return n;
  }, [polygonStats]);

  // v84/v85 — outlier visual treatment. The percentile-rank in the
  // dispatcher buckets areas into riskLevel 1-5 (5 = top 10%);
  // v85 adds an EXTRA tier for areas that exceed 75% of the
  // city's max polygon value (the per-cycle "extreme outlier"
  // band). Pre-v84 a level-5 outlier looked identical to a level-4
  // neighbor — the colorblend math dominated, hiding the percentile
  // signal users rely on for "where should I avoid" judgements.
  //
  // Color stack chosen to be ordered (extreme > outlier > high > low)
  // AND distinct from the PERSONS/PROPERTY/SOCIETY category palette
  // so users don't confuse "lots of violent crime" with "outlier".
  const EXTREME_STROKE = "#7F1D1D"; // darkest crimson — top of city's max
  const OUTLIER_STROKE = "#BE185D"; // crimson-pink — riskLevel=5
  const HIGH_STROKE    = "#9D174D"; // muted plum — riskLevel=4

  function stylePolygon(feat: Feature<Geometry> | undefined): PathOptions {
    if (!feat) return {};
    const name = (feat.properties as { name?: string } | null)?.name ?? "";
    const stats = polygonStats.get(name) ?? null;
    const value = polygonValues.get(name) ?? 0;
    const { fill, opacity, stroke } = fuseColor(stats, value, maxValue);
    const isSel = name === selectedName;
    const lvl = stats?.riskLevel ?? 0;
    const valueShare = maxValue > 0 ? value / maxValue : 0;
    const isExtreme = lvl === 5 && valueShare >= 0.75;
    const isOutlier = lvl === 5 && !isExtreme;
    const isHigh    = lvl === 4;
    let strokeColor = isSel ? "#0E4F73" : stroke;
    let weight = isSel ? 2.5 : 0.9;
    let fillOp = isSel ? Math.min(1, opacity + 0.18) : opacity;
    if (isExtreme && !isSel) {
      strokeColor = EXTREME_STROKE;
      weight = 3.0;
      fillOp = Math.min(1, opacity + 0.22);
    } else if (isOutlier && !isSel) {
      strokeColor = OUTLIER_STROKE;
      weight = 2.4;
      fillOp = Math.min(1, opacity + 0.15);
    } else if (isHigh && !isSel) {
      strokeColor = HIGH_STROKE;
      weight = 1.6;
      fillOp = Math.min(1, opacity + 0.07);
    }
    return {
      fillColor: fill,
      fillOpacity: fillOp,
      color: strokeColor,
      weight,
    };
  }

  function onEachFeature(feat: Feature<Geometry>, layer: Layer) {
    const name = (feat.properties as { name?: string } | null)?.name ?? "";
    const stats = polygonStats.get(name) ?? null;
    layer.bindTooltip(tooltipHtml(name, stats), { sticky: true });
    layer.on({
      click: () => pickPolygon(name),
      mouseover: (e: LeafletMouseEvent) => { (e.target as L.Path).setStyle({ weight: 2 }); },
      mouseout:  (e: LeafletMouseEvent) => { (e.target as L.Path).setStyle({ weight: name === selectedNameRef.current ? 2.5 : 0.9 }); },
    });
  }

  return (
    <div className="space-y-4">
      <NeighborhoodSearch
        value={query}
        onChange={setQuery}
        suggestions={suggestions}
        onSelect={(name) => { pickPolygon(name); setQuery(name); }}
        onClear={() => { pickPolygon(null); setQuery(""); }}
        selectedName={selectedName}
        cityLabel={city.label}
      />

      <div className="surface overflow-hidden relative ring-1 ring-bay-200">
        {(cityLoading || (polygons == null && !polyError)) && (
          <div className="absolute top-3 right-3 z-[400] surface-muted px-3 py-1.5 text-xs text-slate2-500 animate-pulse">
            Loading {city.label} data…
          </div>
        )}
        {polyError && (
          // v102 — graceful boundary-missing state. A few live cities
          // (Baltimore, Fort Worth, Honolulu, Long Beach) don't yet ship a
          // neighborhood-boundary GeoJSON, so the choropleth can't draw.
          // Show an honest, non-alarming note (not a red error) and point
          // users to the working surfaces — the neighborhood selector and
          // the data cards — instead of leaving a broken-looking blank map.
          <div className="absolute top-3 left-3 right-3 z-[400] bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-900">
            An interactive boundary map for {city.label} isn&apos;t available yet. Pick a
            neighborhood from the selector above, or use the {city.label} data cards
            (Safety Index, trends, recent reports) — those are fully live for this city.
          </div>
        )}
        {polygonMismatch && (
          <div className="absolute top-3 left-3 right-3 z-[400] bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-900">
            Map boundaries shown ({city.label}) are not the granularity our
            crime data is aggregated to — pick a neighborhood from the
            dropdown above to see real safety scores. (Source: <a className="underline" href={`/cities/${city.slug}`}>{city.label} coverage</a>.)
          </div>
        )}

        {/* Count vs density toggle — only render when we have polygons AND
            polygon-area data available (otherwise density mode would
            produce zeros). Sits over the top-left of the map. */}
        {polygons && polygonAreasKm2.size > 0 && (
          <div className="absolute top-3 left-3 z-[400] surface-muted px-1 py-1 text-xs flex items-center gap-1 shadow-sm">
            <button
              type="button"
              onClick={() => setMapMode("count")}
              aria-pressed={mapMode === "count"}
              className={`px-2 py-1 rounded transition-colors ${mapMode === "count" ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"}`}
              title="Shade polygons by raw incident count"
            >
              By count
            </button>
            <button
              type="button"
              onClick={() => setMapMode("density")}
              aria-pressed={mapMode === "density"}
              className={`px-2 py-1 rounded transition-colors ${mapMode === "density" ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"}`}
              title="Shade polygons by incidents per square kilometer"
            >
              By density (per km²)
            </button>
          </div>
        )}
        {matchedPolyCount > 0 && (
          <div className="absolute bottom-3 left-3 z-[400] surface-muted px-2.5 py-1.5 text-[11px] text-slate2-700 shadow-sm flex items-center gap-1.5">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-cove-500 inline-block" />
            <span><strong className="text-slate2-900">{matchedPolyCount}</strong> neighborhoods</span>
          </div>
        )}
        <MapContainer
          // v108 — preferCanvas: render polygons + markers on a single <canvas>
          // instead of one SVG DOM node each. The dense city neighborhood
          // GeoJSONs (Honolulu ~276KB gz, SF, Indy…) created thousands of SVG
          // paths → main-thread jank on pan/zoom; canvas is far cheaper.
          preferCanvas
          center={[city.centroid.lat, city.centroid.lng]} zoom={11} scrollWheelZoom
          className="h-[62vh] min-h-[460px] max-h-[720px] w-full"
          aria-label={`Crime map of ${city.label}. Use arrow keys to pan and the plus and minus keys to zoom. Tab to neighborhood markers for individual safety scores.`}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          {polygonsForRender && (
            <GeoJSON
              // v108 — key on data identity ONLY (city + feature count), so the
              // layer is NOT rebuilt on selection/refresh. Selection highlight
              // re-applies via the changing `style` closure (react-leaflet calls
              // setStyle when the style prop ref changes); tooltips refresh via
              // the [polygonStats] effect above; mouseout reads selectedNameRef.
              key={`${city.slug}-${polygonsForRender.features.length}`}
              ref={geoJsonRef}
              data={polygonsForRender}
              style={stylePolygon as L.StyleFunction}
              onEachFeature={onEachFeature}
            />
          )}
          {/* Per-incident drill-down dots only show inside the selected
              neighborhood. Range-validate lat/lng so a malformed upstream
              row can't plot a marker outside world bounds. */}
          {selectedName && (recent?.reports ?? []).map((r) => {
            if (typeof r.lat !== "number" || typeof r.lng !== "number") return null;
            if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
            if (r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) return null;
            const c = CATEGORY_COLOR[r.nibrsCategory];
            return (
              <CircleMarker
                key={r.id}
                center={[r.lat, r.lng]}
                radius={3.5}
                pathOptions={{ color: c.hex, fillColor: c.hex, fillOpacity: 0.85, weight: 0.5 }}
              >
                <Tooltip>
                  <div className="text-xs">
                    <div className="font-medium text-slate2-900">{displayOffenseLabel(r.ibrOffenseDescription)}</div>
                    <div className="text-slate2-500">{c.label} · {new Date(r.occurredAt).toLocaleDateString()}</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
          <InvalidateOnMount />
          <ZoomController polygons={polygons} selectedName={selectedName} fallbackCenter={[city.centroid.lat, city.centroid.lng]} />
        </MapContainer>
      </div>

      {/* v102 — honest footnote: neighborhoods with no published boundary
          (plus the off-polygon "Unmapped" bucket) that can't be drawn on the
          choropleth but still exist in the data + selector. */}
      {unmappedAreas.length > 0 && (
        <p className="mt-2 text-[11px] text-slate2-500 leading-snug" role="note">
          <strong className="text-slate2-700">{unmappedAreas.length} area{unmappedAreas.length === 1 ? "" : "s"} not shown on the map</strong>
          {" "}— {city.label}&apos;s open data has no published boundary for {unmappedAreas.length === 1 ? "it" : "these"}
          {unmappedAreas.includes("Unmapped") ? " (and an “Unmapped” bucket for incidents that fell outside every neighborhood)" : ""}:
          {" "}{unmappedAreas.join(", ")}. {unmappedAreas.length === 1 ? "It is" : "They’re"} still searchable above and included in the data cards.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* City-level legend always visible — explains the blended fill. */}
        <CityLegend />
        {/* When a neighborhood is selected, the per-neighborhood card replaces the
            generic "ranked list" with the drill-down legend and recent offenses. */}
        {selectedStats && selectedName ? (
          <NeighborhoodPanel name={selectedName} stats={selectedStats} recent={recent?.reports ?? []} />
        ) : (
          <CityRanking
            polygons={polygons}
            polygonStats={polygonStats}
            maxCount={maxCount}
            totalIncidents={citywide?.totalIncidents ?? 0}
            cityLabel={city.label}
            onSelect={pickPolygon}
            error={!!cityErr}
          />
        )}
      </div>
    </div>
  );
}

function NeighborhoodSearch({ value, onChange, suggestions, onSelect, onClear, selectedName, cityLabel }: {
  value: string; onChange: (v: string) => void;
  suggestions: string[]; onSelect: (name: string) => void;
  onClear: () => void; selectedName: string | null; cityLabel: string;
}) {
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const blurTimer = useRef<number | null>(null);

  // Keyboard navigation through the suggestion list — Arrow keys move
  // active index, Enter commits, Escape closes. This is the keyboard
  // equivalent of clicking a polygon on the map; without it, users
  // without a mouse couldn't select a neighborhood at all.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!focused || suggestions.length === 0) {
      if (e.key === "Enter" && value.trim()) {
        // Allow Enter to pick the first match even when the dropdown
        // hasn't rendered yet (e.g., user typed rapidly and pressed Enter).
        if (suggestions[0]) { e.preventDefault(); onSelect(suggestions[0]); }
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[activeIdx];
      if (pick) onSelect(pick);
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  }

  return (
    <section className="surface p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-base text-slate2-900">Look up a {cityLabel} neighborhood</h2>
          <p className="text-xs text-slate2-500 mt-0.5">
            Type a name and pick one to zoom in. Keyboard users: Arrow keys move the highlight, Enter commits, Escape closes. This is the full keyboard equivalent of clicking a polygon on the map.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <input
            value={value}
            onChange={(e) => { onChange(e.target.value); setActiveIdx(0); }}
            onFocus={() => { if (blurTimer.current) window.clearTimeout(blurTimer.current); setFocused(true); }}
            onBlur={() => { blurTimer.current = window.setTimeout(() => setFocused(false), 120); }}
            onKeyDown={onKeyDown}
            placeholder="e.g. Mission, Hollywood, Hillcrest"
            className="input text-sm pr-16"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={focused && suggestions.length > 0}
            aria-controls="map-search-listbox"
            aria-activedescendant={focused && suggestions[activeIdx] ? `map-opt-${suggestions[activeIdx]}` : undefined}
            aria-label={`Search ${cityLabel} neighborhoods`}
          />
          {(value || selectedName) && (
            <button
              onClick={onClear}
              aria-label="Clear neighborhood search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate2-500 hover:text-bay-700"
            >
              Clear
            </button>
          )}
          {focused && suggestions.length > 0 && (
            <ul
              id="map-search-listbox"
              role="listbox"
              aria-label={`Matching ${cityLabel} neighborhoods`}
              className="absolute z-30 mt-1 w-full surface bg-white max-h-72 overflow-auto shadow-card-lift"
            >
              {suggestions.map((name, i) => (
                <li key={name} role="option" id={`map-opt-${name}`} aria-selected={i === activeIdx}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); onSelect(name); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    tabIndex={-1}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${i === activeIdx ? "bg-bay-100 text-slate2-900" : "hover:bg-bay-50"}`}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/// Defensive size-recalc helper. Leaflet measures its container at
/// mount; if the container was 0×0 (display:none parent, late layout,
/// orientation change) the tile pane stays empty until something
/// triggers invalidateSize(). We trigger it on first mount, on a
/// window resize, and on orientation change — all the cases that
/// historically produced blank-tile renders on mobile, especially
/// after the user lands on /overwatch via a sub-tab toggle.
function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const fire = () => map.invalidateSize();
    // rAF + a microtask buffer so the call lands AFTER React commits
    // the size of the parent. Without the rAF the call sometimes
    // fires before the container's geometry updates.
    requestAnimationFrame(() => requestAnimationFrame(fire));
    window.addEventListener("resize", fire);
    window.addEventListener("orientationchange", fire);
    return () => {
      window.removeEventListener("resize", fire);
      window.removeEventListener("orientationchange", fire);
    };
  }, [map]);
  return null;
}

function ZoomController({ polygons, selectedName, fallbackCenter }: { polygons: FeatureCollection | null; selectedName: string | null; fallbackCenter: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (!polygons) return;
    if (selectedName) {
      const feat = polygons.features.find((f) => (f.properties as { name?: string } | null)?.name === selectedName);
      if (feat) {
        const layer = L.geoJSON(feat as Feature);
        map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 15 });
        return;
      }
    }
    // No selection — fit the whole city polygon bbox.
    // maxZoom caps how far in we'll zoom for small cities (e.g. DC, SF) so the
    // initial view is always recognizably "the city" rather than three blocks
    // of downtown. fitBounds normally stops at maxZoom or the city's natural
    // fit, whichever is closer in.
    const layer = L.geoJSON(polygons as FeatureCollection);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [12, 12], maxZoom: 12 });
    else map.setView(fallbackCenter, 11);
  }, [polygons, selectedName, fallbackCenter, map]);
  return null;
}

function CityLegend() {
  // Compute the blend example colors using the same fuseColor math the
  // map uses, so the legend example swatches are literally what the
  // user sees on a polygon with that category mix.
  const blend = (w: { PERSONS: number; PROPERTY: number; SOCIETY: number }) => {
    const r = Math.round(w.PERSONS * CATEGORY_COLOR.PERSONS.rgb[0] + w.PROPERTY * CATEGORY_COLOR.PROPERTY.rgb[0] + w.SOCIETY * CATEGORY_COLOR.SOCIETY.rgb[0]);
    const g = Math.round(w.PERSONS * CATEGORY_COLOR.PERSONS.rgb[1] + w.PROPERTY * CATEGORY_COLOR.PROPERTY.rgb[1] + w.SOCIETY * CATEGORY_COLOR.SOCIETY.rgb[1]);
    const b = Math.round(w.PERSONS * CATEGORY_COLOR.PERSONS.rgb[2] + w.PROPERTY * CATEGORY_COLOR.PROPERTY.rgb[2] + w.SOCIETY * CATEGORY_COLOR.SOCIETY.rgb[2]);
    return `rgb(${r},${g},${b})`;
  };
  return (
    <section className="surface p-5 text-sm bg-gradient-to-br from-white to-bay-50">
      <h2 className="font-display text-lg text-slate2-900">How to read this map</h2>
      <p className="mt-2 text-sm text-slate2-700">
        Every neighborhood gets ONE color that mixes together three things at once: which
        crime types were reported, how the mix splits, and how many reports there were.
        Three steps to read a polygon:
      </p>

      <ol className="mt-3 space-y-2 text-sm text-slate2-700 list-decimal pl-5">
        <li>
          <strong className="text-slate2-900">Hue</strong> tells you the dominant crime
          category. Pure red = mostly violent, pure amber = mostly property, pure blue =
          mostly society/public-order.
        </li>
        <li>
          <strong className="text-slate2-900">Mixed colors</strong> mean a mixed crime
          profile. A neighborhood with both violent and property crime renders as a
          red-orange blend. Mostly property + some society reads as a yellow-green.
          The exact tint reflects the share of each category.
        </li>
        <li>
          <strong className="text-slate2-900">Saturation/opacity</strong> rises with
          report volume. A faded polygon = few recent reports. A vivid polygon = many
          recent reports.
        </li>
      </ol>

      <p className="mt-4 text-xs uppercase tracking-wider text-slate2-500 font-medium">Category swatches</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        <LegendRow color={CATEGORY_COLOR.PERSONS.hex}  label="Violent (persons)" detail="Assault, robbery, etc." />
        <LegendRow color={CATEGORY_COLOR.PROPERTY.hex} label="Property"          detail="Theft, burglary, vandalism, vehicle theft" />
        <LegendRow color={CATEGORY_COLOR.SOCIETY.hex}  label="Society / other"   detail="Drug offenses, weapons, public order" />
      </ul>

      <p className="mt-4 text-xs uppercase tracking-wider text-slate2-500 font-medium">Mixed-crime example blends</p>
      <ul className="mt-2 space-y-1.5 text-xs text-slate2-700">
        <li className="flex items-center gap-2">
          <span className="inline-block w-6 h-3 rounded-sm" style={{ background: blend({ PERSONS: 0.5, PROPERTY: 0.5, SOCIETY: 0 }) }} />
          ≈50% violent + ≈50% property
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block w-6 h-3 rounded-sm" style={{ background: blend({ PERSONS: 0.25, PROPERTY: 0.5, SOCIETY: 0.25 }) }} />
          mixed across all three
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block w-6 h-3 rounded-sm" style={{ background: blend({ PERSONS: 0, PROPERTY: 0.5, SOCIETY: 0.5 }) }} />
          ≈50% property + ≈50% society
        </li>
      </ul>

      <p className="mt-4 text-xs uppercase tracking-wider text-slate2-500 font-medium">Report volume</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate2-700">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 h-3 rounded-sm" style={{ background: "#cbd5e1" }} />none</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 h-3 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.45 }} />few</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 h-3 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.7 }} />some</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 h-3 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.95 }} />many</span>
      </div>

      <p className="mt-4 text-xs uppercase tracking-wider text-slate2-500 font-medium">Outlier rank</p>
      <ul className="mt-2 space-y-1 text-xs text-slate2-700">
        <li className="flex items-center gap-2">
          <span className="inline-block w-5 h-3 rounded-sm border-[3px]" style={{ background: CATEGORY_COLOR.PROPERTY.hex, borderColor: "#7F1D1D" }} />
          <span><strong className="text-slate2-900">Extreme</strong> — top 10% AND ≥75% of city max</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block w-5 h-3 rounded-sm border-[2px]" style={{ background: CATEGORY_COLOR.PROPERTY.hex, borderColor: "#BE185D" }} />
          <span><strong className="text-slate2-900">Outlier</strong> — top 10% within this city</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block w-5 h-3 rounded-sm border-[1.5px]" style={{ background: CATEGORY_COLOR.PROPERTY.hex, borderColor: "#9D174D" }} />
          <span>Elevated — top 30% within this city</span>
        </li>
      </ul>

      <p className="mt-4 text-xs uppercase tracking-wider text-slate2-500 font-medium">Boundary type</p>
      <ul className="mt-2 space-y-1 text-xs text-slate2-700">
        <li className="flex items-center gap-2">
          <span className="inline-block w-5 h-3 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.7 }} />
          <span>Solid outline = official polygon boundary</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block w-5 h-3 rounded-full border-2 border-dashed" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.45, borderColor: CATEGORY_COLOR.PROPERTY.hex }} />
          <span>Dashed circle = adapter centroid (approximate)</span>
        </li>
      </ul>

      <p className="mt-4 text-xs text-slate2-500 leading-snug">
        Hover any polygon for the exact mix and report count. Click to drill in and see
        individual recent dispatches.
      </p>
    </section>
  );
}

function LegendRow({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="inline-block w-4 h-4 rounded-sm" style={{ background: color }} />
      <span className="text-slate2-900 font-medium w-40">{label}</span>
      <span className="text-slate2-500 text-xs">{detail}</span>
    </li>
  );
}

function NeighborhoodPanel({ name, stats, recent }: { name: string; stats: AreaBreakdown; recent: RecentIncident[] }) {
  // Top offenses inside this neighborhood, from the recent incident sample.
  const offenseCounts = useMemo(() => {
    const m = new Map<string, { count: number; cat: Cat }>();
    for (const r of recent) {
      const k = r.ibrOffenseDescription || "(unspecified)";
      const cur = m.get(k) ?? { count: 0, cat: r.nibrsCategory as Cat };
      cur.count += 1;
      m.set(k, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
  }, [recent]);

  const total = stats.byCategory.PERSONS + stats.byCategory.PROPERTY + stats.byCategory.SOCIETY || 1;
  return (
    <section className="surface p-5 bg-gradient-to-br from-white to-coral-200/25">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-lg text-slate2-900">{name}</h2>
        <span className="text-xs text-slate2-500 tabular-nums">{stats.incidentCount.toLocaleString()} incidents</span>
      </header>
      <p className="mt-1 text-xs text-slate2-500">Each dot on the map shows one recent incident, colored by the category below.</p>

      <ul className="mt-4 space-y-2 text-sm">
        {(["PERSONS", "PROPERTY", "SOCIETY"] as Cat[]).map((k) => {
          const n = stats.byCategory[k];
          const pct = (n / total) * 100;
          return (
            <li key={k}>
              <div className="flex items-baseline justify-between">
                <span className="inline-flex items-center gap-2 text-slate2-900">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: CATEGORY_COLOR[k].hex }} />
                  {CATEGORY_COLOR[k].label}
                </span>
                <span className="text-xs text-slate2-500 tabular-nums">{n.toLocaleString()} · {pct.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: CATEGORY_COLOR[k].hex }} />
              </div>
            </li>
          );
        })}
      </ul>

      {offenseCounts.length > 0 && (
        <div className="mt-5">
          <h3 className="font-display text-sm text-slate2-900">Most-reported recent offenses</h3>
          <ol className="mt-2 divide-y divide-sand-200">
            {offenseCounts.map(([offense, { count, cat }]) => (
              <li key={offense} className="py-2 flex items-baseline gap-3 text-sm">
                <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CATEGORY_COLOR[cat].hex }} />
                <span className="text-slate2-900 truncate">{displayOffenseLabel(offense)}</span>
                <span className="ml-auto text-xs text-slate2-500 tabular-nums">{count}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate2-500">From the most recent {recent.length} reports the data source returned for this neighborhood.</p>
        </div>
      )}

      {/* fix(audit web-nav-1): each polygon click already syncs the global area
          via pickPolygon → setArea(), so the destination reads the area straight
          from the useArea store. These CTAs previously pointed at /safety-score,
          /trends, /threats — which are server-redirect stubs to the CITYWIDE
          /city page, throwing away the just-selected area. They now point at
          /neighborhood, the per-area view that renders the Safety Index
          (BlockScoreWidget), the 30-day timeline (TrendPanel), and the awareness
          brief (AreaBriefPanel) all scoped to the selected area. Next/Link keeps
          client-side navigation (no full reload) so the store context survives. */}
      <div className="mt-5 flex flex-wrap gap-2 text-xs">
        <Link
          href="/neighborhood"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bay-500 text-white hover:bg-bay-700 transition-colors"
        >
          Safety Index for {name} →
        </Link>
        <Link
          href="/neighborhood"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg surface-muted hover:bg-bay-200 hover:text-bay-700 text-slate2-700 transition-colors"
        >
          30-day timeline for {name} →
        </Link>
        <Link
          href="/neighborhood"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg surface-muted hover:bg-bay-200 hover:text-bay-700 text-slate2-700 transition-colors"
        >
          Awareness brief for {name} →
        </Link>
      </div>
    </section>
  );
}

function CityRanking({ polygons, polygonStats, maxCount, totalIncidents, cityLabel, onSelect, error }: {
  polygons: FeatureCollection | null;
  polygonStats: Map<string, AreaBreakdown | null>;
  maxCount: number;
  totalIncidents: number;
  cityLabel: string;
  onSelect: (name: string) => void;
  error: boolean;
}) {
  const ranked = useMemo(() => {
    const rows: Array<{ name: string; stats: AreaBreakdown | null }> = [];
    for (const feat of polygons?.features ?? []) {
      const name = (feat.properties as { name?: string } | null)?.name ?? "";
      if (!name) continue;
      rows.push({ name, stats: polygonStats.get(name) ?? null });
    }
    return rows.sort((a, b) => (b.stats?.incidentCount ?? 0) - (a.stats?.incidentCount ?? 0));
  }, [polygons, polygonStats]);

  return (
    <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-lg text-slate2-900">Neighborhoods by recent incidents</h2>
        <span className="text-xs text-slate2-500">{totalIncidents.toLocaleString()} total · {cityLabel}</span>
      </header>
      {error && <p className="mt-3 text-sm text-dusk-700">Could not reach the police data feed. Please try again in a moment.</p>}
      <ol className="mt-3 divide-y divide-sand-200 max-h-[420px] overflow-auto pr-1">
        {ranked.slice(0, 25).map(({ name, stats }) => {
          const count = stats?.incidentCount ?? 0;
          const { fill, opacity } = fuseColor(stats, count, maxCount);
          const pct = (count / maxCount) * 100;
          return (
            <li key={name} className="py-2.5">
              <button onClick={() => onSelect(name)} className="w-full text-left group">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-slate2-900 group-hover:text-bay-700 font-medium">{name}</span>
                  <span className="text-xs text-slate2-500 tabular-nums">{count.toLocaleString()}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                  <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: fill, opacity }} />
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
