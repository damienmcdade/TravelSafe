"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useApi } from "@/lib/api-client";

interface KnownArea { slug: string; label: string; jurisdiction: string; centroid: { lat: number; lng: number } }
interface AreaBreakdown {
  slug: string;
  label: string;
  incidentCount: number;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number };
  dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null;
}
interface Citywide {
  totalIncidents: number;
  perArea: AreaBreakdown[];
}

const CATEGORY_COLOR: Record<"PERSONS" | "PROPERTY" | "SOCIETY", { fill: string; stroke: string; label: string }> = {
  PERSONS:  { fill: "#1E78A6", stroke: "#0E4F73", label: "Crimes against persons" },
  PROPERTY: { fill: "#E6643C", stroke: "#8E3819", label: "Property crimes" },
  SOCIETY:  { fill: "#5B9E51", stroke: "#2F6D26", label: "Society / other" },
};
const NEUTRAL = { fill: "#A48E63", stroke: "#6B5A38" };

interface Combined { area: KnownArea; stats: AreaBreakdown | null }

export default function CrimeMap() {
  const { data: areas, loading: areasLoading } = useApi<KnownArea[]>("/geo/areas");
  const { data: citywide, loading: cityLoading, error } = useApi<Citywide>("/crime-data/citywide");
  const [hovered, setHovered] = useState<string | null>(null);

  const combined: Combined[] = useMemo(() => {
    if (!areas) return [];
    const byArea = new Map((citywide?.perArea ?? []).map((p) => [p.slug, p]));
    return areas.map((a) => ({ area: a, stats: byArea.get(a.slug) ?? null }));
  }, [areas, citywide]);

  const maxCount = useMemo(
    () => Math.max(1, ...combined.map((c) => c.stats?.incidentCount ?? 0)),
    [combined],
  );

  return (
    <div className="space-y-4">
      {/* Map — full width, responsive height ------------------------- */}
      <div className="surface overflow-hidden relative ring-1 ring-bay-200">
        {(areasLoading || cityLoading) && (
          <div className="absolute top-3 right-3 z-[400] surface-muted px-3 py-1.5 text-xs text-slate2-500 animate-pulse">
            Loading official SDPD data…
          </div>
        )}
        <MapContainer
          center={[32.78, -117.18]}
          zoom={11}
          scrollWheelZoom
          className="h-[60vh] min-h-[440px] max-h-[680px] w-full"
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          {combined.map(({ area, stats }) => {
            const count = stats?.incidentCount ?? 0;
            const radiusBase = Math.max(12, Math.min(48, 14 + Math.sqrt(count) * 1.7));
            const palette = stats?.dominantCategory ? CATEGORY_COLOR[stats.dominantCategory] : NEUTRAL;
            const isHovered = hovered === area.slug;
            return (
              <CircleMarker
                key={area.slug}
                center={[area.centroid.lat, area.centroid.lng]}
                radius={isHovered ? radiusBase + 4 : radiusBase}
                pathOptions={{
                  color: palette.stroke,
                  fillColor: palette.fill,
                  fillOpacity: isHovered ? 0.7 : 0.5,
                  weight: isHovered ? 3 : 2,
                }}
                eventHandlers={{
                  mouseover: () => setHovered(area.slug),
                  mouseout: () => setHovered(null),
                }}
              >
                <Tooltip direction="top" offset={[0, -radiusBase]} opacity={1}>
                  <div className="font-sans text-xs">
                    <div className="font-semibold text-slate2-900 text-sm">{area.label}</div>
                    <div className="text-slate2-700 mt-0.5">{count.toLocaleString()} incidents (recent window)</div>
                    {stats && (
                      <ul className="mt-1.5 space-y-0.5 text-slate2-500">
                        <li className="flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: CATEGORY_COLOR.PERSONS.fill }} />
                          Persons: <span className="text-slate2-900 font-medium">{stats.byCategory.PERSONS}</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: CATEGORY_COLOR.PROPERTY.fill }} />
                          Property: <span className="text-slate2-900 font-medium">{stats.byCategory.PROPERTY}</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: CATEGORY_COLOR.SOCIETY.fill }} />
                          Society / other: <span className="text-slate2-900 font-medium">{stats.byCategory.SOCIETY}</span>
                        </li>
                      </ul>
                    )}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
          <FitToBounds areas={combined.map((c) => c.area)} />
        </MapContainer>
      </div>

      {/* Legend + ranked list flow below the map -------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Legend />
        <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
          <header className="flex items-baseline justify-between">
            <h2 className="font-display text-lg text-slate2-900">Areas at a glance</h2>
            <span className="text-xs text-slate2-500">{(citywide?.totalIncidents ?? 0).toLocaleString()} total incidents</span>
          </header>
          {error && <p className="mt-3 text-sm text-dusk-700">Couldn&apos;t reach SDPD just now. Try again in a moment.</p>}
          <ol className="mt-3 divide-y divide-sand-200">
            {combined.length === 0 && <li className="py-3 text-sm text-slate2-500">Loading…</li>}
            {combined
              .slice()
              .sort((a, b) => (b.stats?.incidentCount ?? 0) - (a.stats?.incidentCount ?? 0))
              .map(({ area, stats }) => {
                const count = stats?.incidentCount ?? 0;
                const fillPct = (count / maxCount) * 100;
                const palette = stats?.dominantCategory ? CATEGORY_COLOR[stats.dominantCategory] : NEUTRAL;
                return (
                  <li
                    key={area.slug}
                    className={`py-3 px-2 -mx-2 rounded-lg transition-colors ${hovered === area.slug ? "bg-bay-100" : ""}`}
                    onMouseEnter={() => setHovered(area.slug)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/neighborhood`} className="text-slate2-900 hover:text-bay-700 transition-colors font-medium">
                        {area.label}
                      </Link>
                      <span className="text-xs text-slate2-500 tabular-nums">{count.toLocaleString()}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-sand-100 overflow-hidden">
                      <div className="h-full transition-all duration-700 ease-spring" style={{ width: `${fillPct}%`, background: `linear-gradient(90deg, ${palette.fill}, ${palette.stroke})` }} />
                    </div>
                    {stats && stats.dominantCategory && count > 0 && (
                      <div className="mt-1 text-xs text-slate2-500 flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: palette.fill }} />
                        Mostly: <span style={{ color: palette.stroke }} className="font-medium">{CATEGORY_COLOR[stats.dominantCategory].label.toLowerCase()}</span>
                      </div>
                    )}
                  </li>
                );
              })}
          </ol>
        </section>
      </div>
    </div>
  );
}

function FitToBounds({ areas }: { areas: KnownArea[] }) {
  const map = useMap();
  useEffect(() => {
    if (areas.length === 0) return;
    const lats = areas.map((a) => a.centroid.lat);
    const lngs = areas.map((a) => a.centroid.lng);
    const padding = 0.05;
    map.fitBounds([[Math.min(...lats) - padding, Math.min(...lngs) - padding], [Math.max(...lats) + padding, Math.max(...lngs) + padding]]);
  }, [areas, map]);
  return null;
}

function Legend() {
  return (
    <section className="surface p-5 text-sm bg-gradient-to-br from-white to-coral-200/40">
      <h2 className="font-display text-lg text-slate2-900">How to read the map</h2>
      <p className="mt-2 text-xs text-slate2-500">
        Each circle is a San Diego neighborhood. Bigger circle = more SDPD-reported incidents recently.
        Circle color = the most-common incident category in that area.
      </p>
      <div className="mt-4">
        <div className="text-xs font-medium text-slate2-700 mb-2">Color = dominant category</div>
        <ul className="space-y-1.5 text-xs">
          <LegendDot color={CATEGORY_COLOR.PERSONS.fill} label="Crimes against persons (assault, robbery, intimidation)" />
          <LegendDot color={CATEGORY_COLOR.PROPERTY.fill} label="Property crimes (theft, burglary, vandalism)" />
          <LegendDot color={CATEGORY_COLOR.SOCIETY.fill} label="Society / other (drug, weapons, disorderly conduct)" />
        </ul>
      </div>
      <div className="mt-4">
        <div className="text-xs font-medium text-slate2-700 mb-2">Size = number of incidents</div>
        <div className="flex items-end gap-4">
          <SizeChip diameter={20} caption="~10" />
          <SizeChip diameter={32} caption="~100" />
          <SizeChip diameter={48} caption="500+" />
        </div>
      </div>
      <p className="mt-4 text-xs text-slate2-500">
        Higher counts often reflect higher reporting + population density too — not just &quot;more crime.&quot;
      </p>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 inline-block w-3 h-3 rounded-full shrink-0" style={{ background: color, opacity: 0.75 }} />
      <span className="text-slate2-700">{label}</span>
    </li>
  );
}

function SizeChip({ diameter, caption }: { diameter: number; caption: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="inline-block rounded-full"
        style={{ width: diameter, height: diameter, background: CATEGORY_COLOR.PROPERTY.fill, opacity: 0.5, border: `1.5px solid ${CATEGORY_COLOR.PROPERTY.stroke}` }}
      />
      <span className="text-[10px] text-slate2-500">{caption}</span>
    </div>
  );
}
