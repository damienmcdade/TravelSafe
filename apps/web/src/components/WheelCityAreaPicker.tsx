"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity, CITIES } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { WheelPicker, type WheelItem } from "./WheelPicker";

interface AreaRow { slug: string; label: string; jurisdiction: string }
interface AreasResp { areas: AreaRow[]; stale?: boolean }

/// Two-wheel City + Neighborhood picker. Replaces the inline
/// LocationSearch input on Neighborhood Awareness — same job (let the
/// user pick a neighborhood) with the wheel UX users prefer (no
/// typing, every option visible, easy to thumb-scroll). The left
/// wheel changes the selected city, the right wheel scopes to that
/// city's supported neighborhoods. Picking commits to the global
/// useCity / useArea stores so the rest of the app stays in sync.
export function WheelCityAreaPicker() {
  const { city, setCity } = useCity();
  const { area, setArea } = useArea(city.slug);

  // Pending city — lets the user scroll the city wheel without
  // immediately swapping the page. Only commits on "Use this
  // selection". Pending area is similarly local until commit so the
  // user can scrub freely.
  const [pendingCity, setPendingCity] = useState<string>(city.slug);
  const [pendingArea, setPendingArea] = useState<string | null>(area?.slug ?? null);

  // Reset pending state if the global city changes underneath us
  // (e.g., user picks via City Selector header pill).
  useEffect(() => { setPendingCity(city.slug); }, [city.slug]);
  useEffect(() => { setPendingArea(area?.slug ?? null); }, [area?.slug]);

  const pendingCityInfo = CITIES.find((c) => c.slug === pendingCity) ?? city;

  // Fetch neighborhoods for the PENDING city so the right wheel
  // reflects the user's in-progress city pick before commit.
  const areasPath = `/geo/areas?city=${pendingCity}`;
  const { data: areasResp, loading: areasLoading } = useApi<AreasResp>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    const areas = areasResp?.areas ?? [];
    return areas
      .filter((a) => (a?.jurisdiction ?? "").toLowerCase() === pendingCityInfo.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areasResp, pendingCityInfo.label]);

  // When the city changes (pending or committed), default the
  // pending area to the first one in the list so the right wheel
  // has a valid landing position.
  useEffect(() => {
    if (cityAreas.length === 0) return;
    if (pendingArea && cityAreas.some((a) => a.slug === pendingArea)) return;
    setPendingArea(cityAreas[0].slug);
  }, [cityAreas, pendingArea]);

  const cityItems: WheelItem[] = useMemo(
    () => [...CITIES]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((c) => ({
        value: c.slug,
        label: c.label,
        detail: c.stateLabel,
        disabled: c.status !== "live",
      })),
    [],
  );

  const areaItems: WheelItem[] = useMemo(
    () => cityAreas.map((a) => ({
      value: a.slug,
      label: a.label,
      detail: undefined,
    })),
    [cityAreas],
  );

  const dirty = pendingCity !== city.slug || pendingArea !== (area?.slug ?? null);

  function commit() {
    if (pendingCity !== city.slug) setCity(pendingCity);
    if (pendingArea) {
      const picked = cityAreas.find((a) => a.slug === pendingArea);
      if (picked) {
        setArea({ slug: picked.slug, label: picked.label, jurisdiction: picked.jurisdiction });
      }
    }
  }

  return (
    <section className="surface p-4 sm:p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="font-display text-lg text-slate2-900">Pick a city + neighborhood</h3>
          <p className="text-xs text-slate2-500 mt-0.5">
            Spin the wheels to select. Every supported neighborhood for the chosen city is listed in the right wheel — labels wrap so nothing is hidden.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate2-500 mb-1 text-center">City</div>
          <WheelPicker
            items={cityItems}
            value={pendingCity}
            onChange={setPendingCity}
            ariaLabel="City"
            height={220}
            rowHeight={40}
            searchable
            searchPlaceholder="City"
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate2-500 mb-1 text-center">Neighborhood</div>
          {areasLoading && areaItems.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-slate2-500 animate-pulse">
              Loading {pendingCityInfo.label} neighborhoods…
            </div>
          ) : areaItems.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-slate2-500">
              No neighborhoods loaded for {pendingCityInfo.label}.
            </div>
          ) : (
            <WheelPicker
              items={areaItems}
              value={pendingArea ?? areaItems[0]?.value ?? ""}
              onChange={setPendingArea}
              ariaLabel="Neighborhood"
              height={220}
              rowHeight={40}
              searchable
              searchPlaceholder="Neighborhood"
            />
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] text-slate2-500">
          Wheels commit only when you tap the button — scroll freely without disturbing the page.
        </p>
        <button
          onClick={commit}
          disabled={!dirty || !pendingArea}
          className="btn-primary text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Use this selection
        </button>
      </div>
    </section>
  );
}
