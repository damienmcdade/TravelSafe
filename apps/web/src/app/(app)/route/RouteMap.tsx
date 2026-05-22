"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteAlt } from "./page";

interface Props {
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  routes: RouteAlt[];
  selectedIdx: number;
  ratingStrokes: Record<RouteAlt["rating"], { stroke: string }>;
}

function FitBounds({ from, to, routes }: Pick<Props, "from" | "to" | "routes">) {
  const map = useMap();
  useEffect(() => {
    if (routes.length === 0) {
      map.setView([from.lat, from.lng], 13);
      return;
    }
    // Build a bbox over both endpoints + all route polyline points.
    const lats = [from.lat, to.lat, ...routes.flatMap((r) => r.coordinates.map((c) => c[1]))];
    const lngs = [from.lng, to.lng, ...routes.flatMap((r) => r.coordinates.map((c) => c[0]))];
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40] });
  }, [from, to, routes, map]);
  return null;
}

export default function RouteMap({ from, to, routes, selectedIdx, ratingStrokes }: Props) {
  return (
    <div className="surface overflow-hidden ring-1 ring-bay-200">
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
        {routes[selectedIdx] && (
          <Polyline
            positions={routes[selectedIdx].coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
            pathOptions={{ color: ratingStrokes[routes[selectedIdx].rating].stroke, weight: 6, opacity: 1 }}
          />
        )}

        <CircleMarker center={[from.lat, from.lng]} radius={7} pathOptions={{ color: "#0E4F73", fillColor: "#0E4F73", fillOpacity: 1, weight: 2 }}>
          <Tooltip permanent direction="top" offset={[0, -10]}>From</Tooltip>
        </CircleMarker>
        <CircleMarker center={[to.lat, to.lng]} radius={7} pathOptions={{ color: "#0E4F73", fillColor: "#FFFFFF", fillOpacity: 1, weight: 2 }}>
          <Tooltip permanent direction="top" offset={[0, -10]}>To</Tooltip>
        </CircleMarker>

        <FitBounds from={from} to={to} routes={routes} />
      </MapContainer>
    </div>
  );
}
