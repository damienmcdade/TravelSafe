"use client";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useApi } from "@/lib/api-client";

interface KnownArea { slug: string; label: string; jurisdiction: string; centroid: { lat: number; lng: number } }
interface Citywide {
  totalIncidents: number;
  perArea: { slug: string; label: string; incidentCount: number; riskLevel: 1 | 2 | 3 | 4 | 5 }[];
}

interface AreaBreakdown {
  slug: string;
  label: string;
  centroid: { lat: number; lng: number };
  incidentCount: number;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null;
}

// Calm palette per anti-pattern spec: no red-as-default.
const CATEGORY_COLOR: Record<"PERSONS" | "PROPERTY" | "SOCIETY", string> = {
  PERSONS:  "#3A4654", // slate2-700  (neutral)
  PROPERTY: "#C18A2A", // amber2-500  (attention)
  SOCIETY:  "#6C8B62", // sage-500    (calm)
};

export default function CrimeMap() {
  const { data: areas } = useApi<KnownArea[]>("/geo/areas");
  const { data: citywide } = useApi<Citywide>("/crime-data/citywide");
  const [breakdowns, setBreakdowns] = useState<AreaBreakdown[]>([]);

  useEffect(() => {
    if (!areas || !citywide) return;
    const byArea = new Map(citywide.perArea.map((p) => [p.slug, p]));
    const next: AreaBreakdown[] = areas.map((a) => {
      const stats = byArea.get(a.slug);
      return {
        slug: a.slug,
        label: a.label,
        centroid: a.centroid,
        incidentCount: stats?.incidentCount ?? 0,
        riskLevel: stats?.riskLevel ?? 1,
        // We don't have a per-area dominant category from /citywide. TODO: extend the
        // citywide endpoint to return per-area categories. For now, color all neutral
        // and let the size convey volume.
        dominantCategory: null,
      };
    });
    setBreakdowns(next);
  }, [areas, citywide]);

  return (
    <div className="space-y-3">
      <div className="surface overflow-hidden">
        <MapContainer
          center={[32.78, -117.16]}
          zoom={11}
          style={{ height: 520, width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {breakdowns.map((b) => {
            const radius = Math.max(8, Math.min(40, 8 + Math.sqrt(b.incidentCount) * 1.5));
            const color =
              b.dominantCategory ? CATEGORY_COLOR[b.dominantCategory] :
              b.riskLevel >= 4   ? CATEGORY_COLOR.PROPERTY :
              b.riskLevel === 3  ? "#A48E63" :  // sand-500
              "#6C8B62";                         // sage-500
            return (
              <CircleMarker
                key={b.slug}
                center={[b.centroid.lat, b.centroid.lng]}
                radius={radius}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.35, weight: 1.5 }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                  <div className="font-sans">
                    <div className="font-medium text-slate2-900">{b.label}</div>
                    <div className="text-xs text-slate2-600">
                      {b.incidentCount} incidents in cached window
                    </div>
                    <div className="text-xs text-slate2-500">Risk band: {b.riskLevel}/5</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="surface p-4 text-sm">
      <h2 className="font-display text-base text-slate2-900">Legend</h2>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-slate2-500 mb-1">Circle size = volume</div>
          <div className="flex items-center gap-3">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: "#6C8B62", opacity: 0.4 }} />
            <span className="inline-block w-5 h-5 rounded-full" style={{ background: "#6C8B62", opacity: 0.4 }} />
            <span className="inline-block w-8 h-8 rounded-full" style={{ background: "#6C8B62", opacity: 0.4 }} />
            <span className="text-xs text-slate2-700">few → many incidents</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate2-500 mb-1">Color = risk band</div>
          <ul className="space-y-1 text-xs">
            <li className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#6C8B62" }} /> Below typical for this area</li>
            <li className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#A48E63" }} /> Typical for this area</li>
            <li className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#C18A2A" }} /> Above typical</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate2-500">
        Risk bands are derived from incident counts and are not predictive. &quot;Above typical&quot; means
        more reports than this area&apos;s recent baseline — context, not alarm.
      </p>
    </div>
  );
}
