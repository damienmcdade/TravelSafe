"use client";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteAlt } from "./page";
import { RouteHeatLayer } from "./RouteHeatLayer";

interface Props {
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  routes: RouteAlt[];
  selectedIdx: number;
  ratingStrokes: Record<RouteAlt["rating"], { stroke: string }>;
  /// Optional density points for the heat overlay. Each entry is
  /// [lat, lng, weight]. When omitted, the heatmap toggle is hidden.
  /// The toggle now lives in-map (HeatToggleControl) so the user
  /// flips visibility without consuming vertical space outside the
  /// map — mobile UX audit M4 fix.
  heatPoints?: Array<[number, number, number]>;
}

function FitBounds({ from, to, routes }: Pick<Props, "from" | "to" | "routes">) {
  const map = useMap();
  useEffect(() => {
    if (routes.length === 0) {
      map.setView([from.lat, from.lng], 13);
      return;
    }
    // Build a bbox over both endpoints + all route polyline points.
    // Defensive: filter to finite, valid lat/lng. A single NaN/Infinity
    // in the routes coordinates (malformed upstream response) would
    // produce NaN bounds, which Leaflet's fitBounds either crashes on
    // or silently locks to an invalid view.
    const rawLats = [from.lat, to.lat, ...routes.flatMap((r) => (r?.coordinates ?? []).map((c) => c?.[1]))];
    const rawLngs = [from.lng, to.lng, ...routes.flatMap((r) => (r?.coordinates ?? []).map((c) => c?.[0]))];
    const lats = rawLats.filter((n): n is number => Number.isFinite(n) && n >= -90 && n <= 90);
    const lngs = rawLngs.filter((n): n is number => Number.isFinite(n) && n >= -180 && n <= 180);
    if (lats.length === 0 || lngs.length === 0) {
      // Nothing valid to fit — fall back to centering on `from`.
      map.setView([from.lat, from.lng], 13);
      return;
    }
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40] });
  }, [from, to, routes, map]);
  return null;
}

export default function RouteMap({ from, to, routes, selectedIdx, ratingStrokes, heatPoints }: Props) {
  // Heatmap visibility lives inside the map component now so the
  // in-map toggle owns its own state without round-tripping through
  // the page. Persists across re-renders triggered by selectedIdx
  // changes (clicking a route alternative).
  const [heatVisible, setHeatVisible] = useState(false);
  const hasHeatData = !!heatPoints && heatPoints.length > 0;
  return (
    <div className="surface overflow-hidden ring-1 ring-bay-200 relative">
      {hasHeatData && (
        <HeatToggleControl
          visible={heatVisible}
          onToggle={() => setHeatVisible((v) => !v)}
        />
      )}
      <MapContainer center={[from.lat, from.lng]} zoom={13} scrollWheelZoom className="h-[55vh] min-h-[420px] w-full">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>; routes via <a href="https://project-osrm.org/">OSRM</a>'
        />

        {/* Render non-selected routes first so the selected one is on top. */}
        {routes.map((r, i) => {
          if (i === selectedIdx) return null;
          const positions = r.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
          return (
            <Polyline
              key={`bg-${i}`}
              positions={positions}
              pathOptions={{ color: ratingStrokes[r.rating].stroke, weight: 4, opacity: 0.45 }}
            />
          );
        })}
        {routes[selectedIdx]?.coordinates?.length ? (
          <Polyline
            positions={routes[selectedIdx].coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
            pathOptions={{ color: ratingStrokes[routes[selectedIdx].rating].stroke, weight: 6, opacity: 1 }}
          />
        ) : null}

        <CircleMarker center={[from.lat, from.lng]} radius={7} pathOptions={{ color: "#0E4F73", fillColor: "#0E4F73", fillOpacity: 1, weight: 2 }}>
          <Tooltip permanent direction="top" offset={[0, -10]}>From</Tooltip>
        </CircleMarker>
        <CircleMarker center={[to.lat, to.lng]} radius={7} pathOptions={{ color: "#0E4F73", fillColor: "#FFFFFF", fillOpacity: 1, weight: 2 }}>
          <Tooltip permanent direction="top" offset={[0, -10]}>To</Tooltip>
        </CircleMarker>

        {heatPoints && heatPoints.length > 0 && (
          <RouteHeatLayer points={heatPoints} visible={!!heatVisible} />
        )}

        <FitBounds from={from} to={to} routes={routes} />
      </MapContainer>
    </div>
  );
}

/// In-map heatmap toggle. Absolute-positioned over the map at the
/// top-right corner — matches Leaflet's own control placement
/// conventions. z-index sits above the tile layer (Leaflet uses
/// z-index 400 for panes, this control uses 500) but below any
/// popups (700). Pointer-events on the button only so clicks on the
/// surrounding map area still pan as expected.
function HeatToggleControl({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 z-[500]">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={visible}
        className={`pointer-events-auto text-xs px-3 py-1.5 rounded-md shadow-card-lift transition-colors ${
          visible
            ? "bg-bay-500 text-white"
            : "bg-white text-slate2-700 hover:bg-bay-50 border border-bay-200"
        }`}
        title="Toggle the city-wide neighborhood-activity density heatmap on top of the route map."
      >
        {visible ? "Hide heatmap" : "Show heatmap"}
      </button>
    </div>
  );
}
