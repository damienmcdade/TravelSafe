"use client";
// v113 — recipient-side live map for a Live Share link. Loaded with ssr:false
// (Leaflet needs `window`). CartoDB tiles are already allow-listed in the CSP
// img-src, so this renders without any CSP change. A CircleMarker avoids the
// Leaflet default-icon image-path pitfall (and needs no extra asset).
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom() || 15, { animate: true });
  }, [lat, lng, map]);
  return null;
}

export default function ShareLiveMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      scrollWheelZoom
      style={{ height: 360, width: "100%", borderRadius: 12 }}
      aria-label="Live location map"
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <CircleMarker
        center={[lat, lng]}
        radius={10}
        pathOptions={{ color: "#0e7c5a", weight: 3, fillColor: "#22c08a", fillOpacity: 0.85 }}
      >
        <Tooltip permanent direction="top" offset={[0, -8]}>Live location</Tooltip>
      </CircleMarker>
      <Recenter lat={lat} lng={lng} />
    </MapContainer>
  );
}
