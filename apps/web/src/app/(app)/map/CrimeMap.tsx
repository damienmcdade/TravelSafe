"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Tooltip, CircleMarker, useMap } from "react-leaflet";
import type { Layer, LeafletMouseEvent, PathOptions } from "leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "leaflet/dist/leaflet.css";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

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

// Three calm category colors. No alarmist red — coral is the warmest tone we use.
const CATEGORY_COLOR = {
  PERSONS:  { rgb: [230, 100,  60], label: "Violent (persons)", hex: "#E6643C" },
  PROPERTY: { rgb: [224, 150,  42], label: "Property",          hex: "#E0962A" },
  SOCIETY:  { rgb: [ 30, 120, 166], label: "Society / other",   hex: "#1E78A6" },
} as const;
const NO_DATA_RGB = [200, 200, 200] as const;
type Cat = keyof typeof CATEGORY_COLOR;

// Known spelling variants between the official polygon files and what the
// police department prints in their NIBRS column. Both sides get normalized
// through this table before fuzzy-matching kicks in. Each entry is two
// names that should be treated as identical.
const NAME_ALIASES: Array<[string, string]> = [
  // San Diego — polygon vs SDPD column spellings.
  ["fairmount", "fairmont"],
  ["tierra santa", "tierrasanta"],
  ["kearney mesa", "kearny mesa"],
  ["ofarrell", "o farrell"],
  // Denver — the Stapleton neighborhood was officially renamed "Central Park"
  // in 2020 after community vote. The polygon file still says Stapleton; the
  // adapter receives "central-park" from Denver Open Data.
  ["stapleton", "central park"],
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
    .replace(/\bdenver\b/g, "den")
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
function fuseColor(breakdown: AreaBreakdown | null, maxCount: number): { fill: string; opacity: number; stroke: string } {
  if (!breakdown || breakdown.incidentCount === 0) {
    return { fill: `rgb(${NO_DATA_RGB.join(",")})`, opacity: 0.10, stroke: "#94a3b8" };
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
  // Floor at 0.25 so even small counts read as colored; ceiling at 0.78 so
  // hover/selection can still pop above the base layer.
  const opacity = 0.25 + Math.min(1, breakdown.incidentCount / Math.max(1, maxCount)) * 0.53;
  return { fill: `rgb(${r},${g},${b})`, opacity, stroke: `rgb(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(0, b - 40)})` };
}

function describeMix(b: AreaBreakdown | null): string {
  if (!b || b.incidentCount === 0) return "no recent incidents";
  const parts: string[] = [];
  for (const k of ["PERSONS", "PROPERTY", "SOCIETY"] as Cat[]) {
    const n = b.byCategory[k];
    if (n > 0) parts.push(`${CATEGORY_COLOR[k].label.toLowerCase()} ${n}`);
  }
  return parts.join(" · ");
}

export default function CrimeMap() {
  const { city } = useCity();

  // Static polygon file is one of three small GeoJSONs in /public/geo/.
  const [polygons, setPolygons] = useState<FeatureCollection | null>(null);
  const [polyError, setPolyError] = useState<string | null>(null);
  useEffect(() => {
    setPolygons(null); setPolyError(null);
    fetch(`/geo/${city.slug}.geojson`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((d: FeatureCollection) => setPolygons(d))
      .catch((e) => setPolyError(`Could not load ${city.label} neighborhood boundaries (${(e as Error).message}).`));
  }, [city.slug, city.label]);

  const { data: areas } = useApi<KnownArea[]>("/geo/areas");
  const path = `/crime-data/citywide?city=${city.slug}`;
  const { data: citywide, loading: cityLoading, error: cityErr } = useApi<Citywide>(path, [path]);

  // Match polygon name → our area slug via fuzzy normalized comparison.
  const polygonStats = useMemo(() => {
    if (!polygons) return new Map<string, AreaBreakdown | null>();
    const cityAreas = (areas ?? []).filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase());
    const byNormLabel = new Map(cityAreas.map((a) => [normName(a.label), a.slug]));
    const statsBySlug = new Map((citywide?.perArea ?? []).map((p) => [p.slug, p]));
    const out = new Map<string, AreaBreakdown | null>();
    for (const feat of polygons.features) {
      const polyName = (feat.properties as { name?: string } | null)?.name ?? "";
      const norm = normName(polyName);
      // exact, then substring fallback
      let slug = byNormLabel.get(norm);
      if (!slug) {
        for (const [labelNorm, s] of byNormLabel) {
          if (labelNorm === norm) continue;
          if (labelNorm.includes(norm) || norm.includes(labelNorm)) { slug = s; break; }
        }
      }
      out.set(polyName, slug ? (statsBySlug.get(slug) ?? null) : null);
    }
    return out;
  }, [polygons, areas, citywide, city.label]);

  const maxCount = useMemo(() => Math.max(1, ...Array.from(polygonStats.values()).map((s) => s?.incidentCount ?? 0)), [polygonStats]);

  // ---- Selection (autocomplete + zoom + drill-down) ------------------------
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const polygonNames = useMemo(
    () => (polygons?.features ?? []).map((f) => (f.properties as { name?: string } | null)?.name ?? "").filter(Boolean).sort(),
    [polygons],
  );
  const suggestions = useMemo(() => {
    if (!query) return [] as string[];
    const q = normName(query);
    return polygonNames.filter((n) => normName(n).includes(q)).slice(0, 8);
  }, [polygonNames, query]);

  useEffect(() => { setSelectedName(null); setQuery(""); }, [city.slug]);

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

  function stylePolygon(feat: Feature<Geometry> | undefined): PathOptions {
    if (!feat) return {};
    const name = (feat.properties as { name?: string } | null)?.name ?? "";
    const stats = polygonStats.get(name) ?? null;
    const { fill, opacity, stroke } = fuseColor(stats, maxCount);
    const isSel = name === selectedName;
    return {
      fillColor: fill,
      fillOpacity: isSel ? Math.min(1, opacity + 0.18) : opacity,
      color: isSel ? "#0E4F73" : stroke,
      weight: isSel ? 2.5 : 0.9,
    };
  }

  function onEachFeature(feat: Feature<Geometry>, layer: Layer) {
    const name = (feat.properties as { name?: string } | null)?.name ?? "";
    const stats = polygonStats.get(name) ?? null;
    layer.bindTooltip(
      `<div style="font-family:inherit"><div style="font-weight:600;color:#1C232C">${name}</div>` +
      `<div style="font-size:0.75rem;color:#4b5563">${describeMix(stats)}</div></div>`,
      { sticky: true },
    );
    layer.on({
      click: () => setSelectedName(name),
      mouseover: (e: LeafletMouseEvent) => { (e.target as L.Path).setStyle({ weight: 2 }); },
      mouseout:  (e: LeafletMouseEvent) => { (e.target as L.Path).setStyle({ weight: name === selectedName ? 2.5 : 0.9 }); },
    });
  }

  return (
    <div className="space-y-4">
      <NeighborhoodSearch
        value={query}
        onChange={setQuery}
        suggestions={suggestions}
        onSelect={(name) => { setSelectedName(name); setQuery(name); }}
        onClear={() => { setSelectedName(null); setQuery(""); }}
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
          <div className="absolute top-3 left-3 right-3 z-[400] surface-muted px-3 py-1.5 text-xs text-coral-700">
            {polyError}
          </div>
        )}
        <MapContainer center={[city.centroid.lat, city.centroid.lng]} zoom={11} scrollWheelZoom className="h-[62vh] min-h-[460px] max-h-[720px] w-full">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          {polygons && (
            <GeoJSON
              key={`${city.slug}-${maxCount}-${selectedName ?? ""}`}
              data={polygons}
              style={stylePolygon as L.StyleFunction}
              onEachFeature={onEachFeature}
            />
          )}
          {/* Per-incident drill-down dots only show inside the selected neighborhood. */}
          {selectedName && (recent?.reports ?? []).map((r) => {
            if (typeof r.lat !== "number" || typeof r.lng !== "number") return null;
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
                    <div className="font-medium text-slate2-900">{r.ibrOffenseDescription}</div>
                    <div className="text-slate2-500">{c.label} · {new Date(r.occurredAt).toLocaleDateString()}</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
          <ZoomController polygons={polygons} selectedName={selectedName} fallbackCenter={[city.centroid.lat, city.centroid.lng]} />
        </MapContainer>
      </div>

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
            onSelect={setSelectedName}
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
  const blurTimer = useRef<number | null>(null);
  return (
    <section className="surface p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-base text-slate2-900">Look up a {cityLabel} neighborhood</h2>
          <p className="text-xs text-slate2-500 mt-0.5">Start typing — pick a name to zoom into that neighborhood and see its individual offenses.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => { if (blurTimer.current) window.clearTimeout(blurTimer.current); setFocused(true); }}
            onBlur={() => { blurTimer.current = window.setTimeout(() => setFocused(false), 120); }}
            placeholder="e.g. Mission, Hollywood, Hillcrest"
            className="input text-sm pr-16"
            autoComplete="off"
          />
          {(value || selectedName) && (
            <button onClick={onClear} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate2-500 hover:text-bay-700">Clear</button>
          )}
          {focused && suggestions.length > 0 && (
            <ul className="absolute z-30 mt-1 w-full surface bg-white max-h-72 overflow-auto shadow-card-lift">
              {suggestions.map((name) => (
                <li key={name}>
                  <button onMouseDown={(e) => { e.preventDefault(); onSelect(name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-bay-50">
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
    const layer = L.geoJSON(polygons as FeatureCollection);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
    else map.setView(fallbackCenter, 11);
  }, [polygons, selectedName, fallbackCenter, map]);
  return null;
}

function CityLegend() {
  return (
    <section className="surface p-5 text-sm bg-gradient-to-br from-white to-bay-50">
      <h2 className="font-display text-lg text-slate2-900">Reading the colors</h2>
      <p className="mt-2 text-xs text-slate2-500">
        Each neighborhood is filled with a single color that blends together the recent crime mix. Saturation rises with the number of incidents — paler areas have fewer reports, vivid areas have more.
      </p>
      <ul className="mt-4 space-y-1.5 text-sm">
        <LegendRow color={CATEGORY_COLOR.PERSONS.hex}  label="Violent (persons)" detail="Assault, robbery, etc." />
        <LegendRow color={CATEGORY_COLOR.PROPERTY.hex} label="Property"          detail="Theft, burglary, vandalism, vehicle theft" />
        <LegendRow color={CATEGORY_COLOR.SOCIETY.hex}  label="Society / other"   detail="Drug offenses, weapons, public order" />
      </ul>
      <p className="mt-4 text-xs text-slate2-500">Mixed colors mean a mixed crime profile. A neighborhood with mostly property crime but some violent crime appears as a warmer orange, not pure amber.</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate2-500">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: "#cbd5e1" }} />no data</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.3 }} />few</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.55 }} />some</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: CATEGORY_COLOR.PROPERTY.hex, opacity: 0.78 }} />many</span>
      </div>
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
                <span className="text-slate2-900 truncate">{offense}</span>
                <span className="ml-auto text-xs text-slate2-500 tabular-nums">{count}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate2-500">From the most recent {recent.length} reports the data source returned for this neighborhood.</p>
        </div>
      )}
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
          const { fill, opacity } = fuseColor(stats, maxCount);
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
