"use client";
import { useEffect, useState } from "react";
import { api, useApi, useAnonymousAuth } from "@/lib/api-client";
import { requestLocation, GeolocationError } from "@/lib/geolocation";
import { ensurePushSubscription } from "@/lib/push";
import { useCity } from "@/lib/use-city";

interface SavedPlace {
  id: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
  alertsEnabled: boolean;
  lastAlertAt: string | null;
  createdAt: string;
}

const GRADE_TONE: Record<string, string> = {
  A: "#7BA86E", B: "#2563EB", C: "#94a3b8", D: "#F59E0B", E: "#DC2626", F: "#DC2626",
};

// Saved Places / "Alert Zones" — the Citizen-style feature: save the places you
// care about (home, work, a relative's), see each one's current safety at a
// glance, and get a push alert when a new incident is reported nearby.
export function SavedPlacesPanel() {
  const { ready: signedIn } = useAnonymousAuth();
  const { city } = useCity();
  const { data, reload } = useApi<{ places: SavedPlace[] }>(signedIn ? "/saved-places" : null, [signedIn]);
  const places = data?.places ?? [];

  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Push-permission state so we can prompt the user to actually enable
  // notifications — without a subscription the proximity worker has nowhere to
  // deliver. "granted" = subscribed & alerts can reach this device.
  const [pushPerm, setPushPerm] = useState<"default" | "granted" | "denied" | "unsupported">("default");
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") { setPushPerm("unsupported"); return; }
    setPushPerm(Notification.permission as "default" | "granted" | "denied");
  }, []);
  async function enablePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const r = await ensurePushSubscription();
      setPushPerm(r.ok ? "granted" : (typeof Notification !== "undefined" ? (Notification.permission as "default" | "denied") : "unsupported"));
    } finally {
      setPushBusy(false);
    }
  }

  async function add(lat: number, lng: number) {
    const name = label.trim() || "My place";
    await api("/saved-places", { method: "POST", body: JSON.stringify({ label: name, lat, lng }) });
    setLabel(""); setAddr("");
    await reload();
  }

  async function addByLocation() {
    setBusy(true); setError(null);
    try {
      const pos = await requestLocation();
      await add(pos.coords.latitude, pos.coords.longitude);
    } catch (e) {
      setError(e instanceof GeolocationError ? e.message : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function addByAddress() {
    if (!addr.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ area: { centroid: { lat: number; lng: number } } }>(
        `/geo/lookup?q=${encodeURIComponent(addr)}&city=${encodeURIComponent(city.slug)}`,
      );
      await add(r.area.centroid.lat, r.area.centroid.lng);
    } catch (e) {
      setError(`Could not find that address: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function toggleAlerts(p: SavedPlace) {
    await api(`/saved-places/${p.id}`, { method: "PATCH", body: JSON.stringify({ alertsEnabled: !p.alertsEnabled }) });
    await reload();
  }
  async function remove(p: SavedPlace) {
    await api(`/saved-places/${p.id}`, { method: "DELETE" });
    await reload();
  }

  return (
    <section className="surface p-6">
      <h2 className="font-display text-xl text-slate2-900">Your places · Alert Zones</h2>
      <p className="mt-1 text-sm text-slate2-500">
        Save the places you care about — home, work, a family member&apos;s address. CommunitySafe
        watches each one and can <strong>notify you when a new incident is reported nearby</strong>,
        even when you&apos;re not there. (Enable browser notifications for alerts to reach you.)
      </p>

      {!signedIn ? (
        <p className="mt-3 text-sm text-slate2-500">Sign in to save places and get proximity alerts.</p>
      ) : (
        <>
          {/* Push-permission prompt — without a subscription the proximity
              worker has nowhere to deliver, so close the loop here. */}
          {pushPerm === "granted" ? (
            <p className="mt-3 text-xs text-sage-700">🔔 Notifications are on — proximity alerts can reach this device.</p>
          ) : pushPerm === "denied" ? (
            <p className="mt-3 text-xs text-amber2-700">
              Notifications are blocked in your browser. Re-enable them for this site in your browser settings to receive proximity alerts.
            </p>
          ) : pushPerm === "unsupported" ? (
            <p className="mt-3 text-xs text-slate2-500">This browser doesn’t support push notifications, so alerts can’t be delivered here.</p>
          ) : (
            <button
              onClick={enablePush}
              disabled={pushBusy}
              className="mt-3 text-sm px-3 py-1.5 rounded-lg bg-bay-500 text-white disabled:opacity-50"
            >
              {pushBusy ? "Enabling…" : "🔔 Enable alert notifications"}
            </button>
          )}

          {places.length > 0 && (
            <ul className="mt-4 space-y-2">
              {places.map((p) => <PlaceRow key={p.id} place={p} onToggle={() => toggleAlerts(p)} onRemove={() => remove(p)} />)}
            </ul>
          )}

          <div className="mt-4 rounded-xl bg-sand-50 border border-bay-100 p-3 space-y-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name this place (e.g. Home, Work, Mom's)"
              maxLength={60}
              className="input text-sm"
              aria-label="Place name"
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={addByLocation} disabled={busy} className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50">
                📍 Use my current location
              </button>
              <div className="flex-1 min-w-[200px] flex gap-1">
                <input
                  value={addr}
                  onChange={(e) => setAddr(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addByAddress(); } }}
                  placeholder={`or type an address in ${city.label}`}
                  className="input text-sm flex-1"
                  aria-label="Place address"
                />
                <button onClick={addByAddress} disabled={busy || !addr.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-bay-500 text-white disabled:opacity-50">
                  Add
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-coral-700">{error}</p>}
            <p className="text-[11px] text-slate2-500">
              Addresses snap to the nearest tracked neighborhood centroid for scoring — CommunitySafe stores the place, not your live movements.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function PlaceRow({ place, onToggle, onRemove }: { place: SavedPlace; onToggle: () => void; onRemove: () => void }) {
  const [summary, setSummary] = useState<{ areaLabel: string; grade: string | null } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const look = await api<{ area: { slug: string; label: string } }>(`/geo/lookup?lat=${place.lat}&lng=${place.lng}`);
        const score = await api<{ grade: string | null }>(`/safezone/safety-score?area=${encodeURIComponent(look.area.slug)}`);
        if (!cancelled) setSummary({ areaLabel: look.area.label, grade: score.grade ?? null });
      } catch { if (!cancelled) setSummary({ areaLabel: "—", grade: null }); }
    })();
    return () => { cancelled = true; };
  }, [place.lat, place.lng]);

  const grade = summary?.grade ?? null;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-bay-100 p-3">
      <span
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-white font-display text-sm shrink-0"
        style={{ background: grade ? (GRADE_TONE[grade] ?? "#94a3b8") : "#cbd5e1" }}
        title={grade ? `Nearest area grade ${grade}` : "Loading…"}
      >
        {grade ?? "·"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate2-900 truncate">{place.label}</div>
        <div className="text-xs text-slate2-500 truncate">
          {summary ? `Near ${summary.areaLabel}` : "Locating…"} · {Math.round(place.radiusM / 100) / 10} km radius
        </div>
      </div>
      <button
        onClick={() => { setWorking(true); Promise.resolve(onToggle()).finally(() => setWorking(false)); }}
        disabled={working}
        className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${place.alertsEnabled ? "bg-sage-100 text-sage-800" : "bg-slate2-100 text-slate2-500"}`}
        aria-pressed={place.alertsEnabled}
        title={place.alertsEnabled ? "Alerts on — tap to mute" : "Alerts off — tap to enable"}
      >
        {place.alertsEnabled ? "🔔 Alerts on" : "🔕 Muted"}
      </button>
      <button onClick={onRemove} className="text-xs text-slate2-500 hover:text-coral-700" aria-label={`Remove ${place.label}`}>
        ✕
      </button>
    </li>
  );
}
