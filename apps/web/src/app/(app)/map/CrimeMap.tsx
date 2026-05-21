"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
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
interface Citywide {
  city: string;
  totalIncidents: number;
  appliedOffense: string | null;
  topOffenses: TopOffense[];
  perArea: AreaBreakdown[];
}

// Calm 5-band intensity ramp (sage → sand → amber → coral). No red as default.
const BANDS = [
  { min: 0,    max: 4,    label: "Very low",  zone: "1–4",       fill: "#5B9E51", stroke: "#2F6D26" },
  { min: 5,   max: 19,   label: "Low",       zone: "5–19",      fill: "#B5C77C", stroke: "#6A7E3A" },
  { min: 20,   max: 79,  label: "Moderate",  zone: "20–79",     fill: "#E0962A", stroke: "#7E5C18" },
  { min: 80,  max: 199,  label: "Elevated",  zone: "80–199",    fill: "#E6643C", stroke: "#8E3819" },
  { min: 200,  max: Infinity, label: "High", zone: "200+",      fill: "#8E3819", stroke: "#4F1D0E" },
];
function bandFor(count: number) {
  return BANDS.find((b) => count >= b.min && count <= b.max) ?? BANDS[0];
}
function zoneRadiusMeters(count: number): number {
  if (count <= 0) return 700;
  return Math.min(4500, 1000 + Math.sqrt(count) * 160);
}

interface Combined { area: KnownArea; stats: AreaBreakdown | null }

export default function CrimeMap() {
  const { city } = useCity();
  const [offense, setOffense] = useState<string>("");
  // Reset offense filter when the city changes — its offense list won't apply
  // to the new city.
  useEffect(() => { setOffense(""); }, [city.slug]);

  const { data: areas, loading: areasLoading } = useApi<KnownArea[]>("/geo/areas");
  const path = `/crime-data/citywide?city=${city.slug}${offense ? `&offense=${encodeURIComponent(offense)}` : ""}`;
  const { data: citywide, loading: cityLoading, error } = useApi<Citywide>(path, [path]);
  const [hovered, setHovered] = useState<string | null>(null);

  const combined: Combined[] = useMemo(() => {
    if (!areas) return [];
    const cityAreas = areas.filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase());
    const byArea = new Map((citywide?.perArea ?? []).map((p) => [p.slug, p]));
    return cityAreas.map((a) => ({ area: a, stats: byArea.get(a.slug) ?? null }));
  }, [areas, citywide, city.label]);
  const maxCount = useMemo(() => Math.max(1, ...combined.map((c) => c.stats?.incidentCount ?? 0)), [combined]);

  const offenseOptions = citywide?.topOffenses ?? [];

  return (
    <div className="space-y-4">
      <OffenseSelector
        offenses={offenseOptions}
        value={offense}
        onChange={setOffense}
        loading={cityLoading}
      />

      <div className="surface overflow-hidden relative ring-1 ring-bay-200">
        {(areasLoading || cityLoading) && (
          <div className="absolute top-3 right-3 z-[400] surface-muted px-3 py-1.5 text-xs text-slate2-500 animate-pulse">
            Loading {city.label} data…
          </div>
        )}
        <MapContainer
          center={[city.centroid.lat, city.centroid.lng]}
          zoom={12}
          scrollWheelZoom
          className="h-[62vh] min-h-[460px] max-h-[720px] w-full"
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          {combined.map(({ area, stats }) => {
            const count = stats?.incidentCount ?? 0;
            const band = bandFor(count);
            const radius = zoneRadiusMeters(count);
            const isHovered = hovered === area.slug;
            return (
              <Circle
                key={area.slug}
                center={[area.centroid.lat, area.centroid.lng]}
                radius={radius}
                pathOptions={{
                  color: band.stroke,
                  fillColor: band.fill,
                  fillOpacity: isHovered ? 0.55 : 0.32,
                  weight: isHovered ? 2 : 1.25,
                }}
                eventHandlers={{
                  mouseover: () => setHovered(area.slug),
                  mouseout: () => setHovered(null),
                }}
              >
                <Tooltip direction="top" opacity={1} sticky>
                  <div className="font-sans text-xs">
                    <div className="font-semibold text-slate2-900 text-sm">{area.label}</div>
                    <div className="mt-0.5 text-slate2-700">
                      <span className="font-medium" style={{ color: band.stroke }}>{band.label}</span> · {count.toLocaleString()} {offense ? `\"${offense}\" incidents` : "incidents"}
                    </div>
                    {!offense && stats && (
                      <ul className="mt-1.5 space-y-0.5 text-slate2-500">
                        <li>Persons: <span className="text-slate2-900 font-medium">{stats.byCategory.PERSONS}</span></li>
                        <li>Property: <span className="text-slate2-900 font-medium">{stats.byCategory.PROPERTY}</span></li>
                        <li>Society / other: <span className="text-slate2-900 font-medium">{stats.byCategory.SOCIETY}</span></li>
                      </ul>
                    )}
                  </div>
                </Tooltip>
              </Circle>
            );
          })}
          <FitToCity bbox={(() => {
            if (combined.length === 0) return null;
            const lats = combined.map((c) => c.area.centroid.lat);
            const lngs = combined.map((c) => c.area.centroid.lng);
            return [[Math.min(...lats) - 0.03, Math.min(...lngs) - 0.03], [Math.max(...lats) + 0.03, Math.max(...lngs) + 0.03]] as [[number, number], [number, number]];
          })()} cityCenter={[city.centroid.lat, city.centroid.lng]} />
        </MapContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Legend offense={offense} />
        <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
          <header className="flex items-baseline justify-between">
            <h2 className="font-display text-lg text-slate2-900">
              {offense ? `Areas ranked by "${offense}"` : "Areas ranked by recent incidents"}
            </h2>
            <span className="text-xs text-slate2-500">{(citywide?.totalIncidents ?? 0).toLocaleString()} matching</span>
          </header>
          {error && <p className="mt-3 text-sm text-dusk-700">Could not reach the {city.label} police data feed. Please try again in a moment.</p>}
          <ol className="mt-3 divide-y divide-sand-200">
            {combined.length === 0 && <li className="py-3 text-sm text-slate2-500">Loading…</li>}
            {combined
              .slice()
              .sort((a, b) => (b.stats?.incidentCount ?? 0) - (a.stats?.incidentCount ?? 0))
              .map(({ area, stats }) => {
                const count = stats?.incidentCount ?? 0;
                const band = bandFor(count);
                const fillPct = (count / maxCount) * 100;
                return (
                  <li
                    key={area.slug}
                    className={`py-3 px-2 -mx-2 rounded-lg transition-colors ${hovered === area.slug ? "bg-bay-100" : ""}`}
                    onMouseEnter={() => setHovered(area.slug)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/neighborhood`} className="text-slate2-900 hover:text-bay-700 transition-colors font-medium">{area.label}</Link>
                      <span className="text-xs text-slate2-500 tabular-nums">{count.toLocaleString()}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-sand-100 overflow-hidden">
                      <div className="h-full transition-all duration-700 ease-spring" style={{ width: `${fillPct}%`, background: `linear-gradient(90deg, ${band.fill}, ${band.stroke})` }} />
                    </div>
                    <div className="mt-1 text-xs flex items-center gap-1.5" style={{ color: band.stroke }}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: band.fill }} />
                      {band.label}
                    </div>
                  </li>
                );
              })}
          </ol>
        </section>
      </div>
    </div>
  );
}

function OffenseSelector({ offenses, value, onChange, loading }: { offenses: TopOffense[]; value: string; onChange: (v: string) => void; loading: boolean }) {
  return (
    <section className="surface p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-base text-slate2-900">Filter the map by a specific offense</h2>
          <p className="text-xs text-slate2-500 mt-0.5">Choose any specific offense to color the zones by how often that offense was reported. Pick &quot;All offenses&quot; to see total volume.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate2-500">Offense</label>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input min-w-[18rem] py-1.5 text-sm"
            disabled={loading && offenses.length === 0}
          >
            <option value="">All offenses (total volume)</option>
            {offenses.map((o) => (
              <option key={o.offense} value={o.offense}>
                {o.offense} ({o.count.toLocaleString()})
              </option>
            ))}
          </select>
          {value && (
            <button onClick={() => onChange("")} className="btn-ghost text-xs">Clear</button>
          )}
        </div>
      </div>
    </section>
  );
}

function FitToCity({ bbox, cityCenter }: { bbox: [[number, number], [number, number]] | null; cityCenter: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (bbox) map.fitBounds(bbox, { padding: [20, 20] });
    else map.setView(cityCenter, 12);
  }, [bbox, cityCenter, map]);
  return null;
}

function Legend({ offense }: { offense: string }) {
  return (
    <section className="surface p-5 text-sm bg-gradient-to-br from-white to-coral-200/30">
      <h2 className="font-display text-lg text-slate2-900">Reading the map</h2>
      <p className="mt-2 text-xs text-slate2-500">
        {offense
          ? `Each colored zone shows how often "${offense}" was reported in that neighborhood during the recent cached window. The map auto-refreshes every 10 minutes.`
          : "Each colored zone covers one neighborhood. Color shows how many incidents were reported there during the recent cached window. The map auto-refreshes every 10 minutes."}
      </p>
      <div className="mt-4">
        <div className="text-xs font-medium text-slate2-700 mb-2">Color band = incident count</div>
        <ul className="space-y-1.5 text-xs">
          {BANDS.map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 rounded-sm border" style={{ background: b.fill, borderColor: b.stroke, opacity: 0.7 }} />
              <span className="text-slate2-900 font-medium w-20">{b.label}</span>
              <span className="text-slate2-500">{b.zone} incidents</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-xs text-slate2-500">
        Higher counts often reflect higher reporting and population density, not only the actual rate of crime.
      </p>
    </section>
  );
}
