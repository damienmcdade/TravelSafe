"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTheme, type Theme } from "@/lib/use-theme";

// Local-state inventory the page can clear on demand. Every key
// that survives a tab/page navigation lives in this list — if a new
// localStorage-backed preference is added elsewhere, add its key
// here so the user can reset it from the privacy dashboard.
const LOCAL_KEYS = [
  { key: "travelsafe.city.v1",            label: "City selection" },
  { key: "travelsafe.area.v1",            label: "Area / neighborhood selection (per city)" },
  { key: "travelsafe.token",              label: "Anonymous session token" },
  { key: "travelsafe.assistant.v1",       label: "AI Assistant conversation state" },
  { key: "travelsafe.news.sources.v1",    label: "News-source visibility preferences" },
  { key: "travelsafe.news.window.v1",     label: "News time-window choice" },
  { key: "travelsafe.crime-chart.window.v1", label: "Crime Chart time-window choice" },
  { key: "travelsafe.crime-mix.category.v1", label: "Crime Mix category filter" },
  { key: "travelsafe.saved-areas.v1",     label: "Saved areas list" },
  { key: "travelsafe.safety.disclaimer.ack", label: "Personal Safety disclaimer acknowledgement" },
];

const SWR_PREFIX = "travelsafe.swr.v1.";

export default function PrivacyDashboardPage() {
  useDocumentTitle("Privacy controls");
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [pushStatus, setPushStatus] = useState<"unknown" | "denied" | "granted" | "default" | "unsupported">("unknown");
  const [swrEntryCount, setSwrEntryCount] = useState<number>(0);
  const [justCleared, setJustCleared] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const e of LOCAL_KEYS) next[e.key] = window.localStorage.getItem(e.key) != null;
    setPresent(next);
    let swrCount = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(SWR_PREFIX)) swrCount += 1;
    }
    setSwrEntryCount(swrCount);
    if (typeof Notification === "undefined") {
      setPushStatus("unsupported");
    } else {
      setPushStatus(Notification.permission as typeof pushStatus);
    }
  }, []);

  function clearOne(key: string, label: string) {
    try { window.localStorage.removeItem(key); } catch { /* ignore quota */ }
    setPresent((prev) => ({ ...prev, [key]: false }));
    setJustCleared(label);
    setTimeout(() => setJustCleared(null), 2500);
  }

  function clearAllPrefs() {
    for (const e of LOCAL_KEYS) {
      try { window.localStorage.removeItem(e.key); } catch { /* ignore */ }
    }
    setPresent(Object.fromEntries(LOCAL_KEYS.map((e) => [e.key, false])));
    setJustCleared("All saved preferences");
    setTimeout(() => setJustCleared(null), 2500);
  }

  function clearSwrCache() {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(SWR_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) {
      try { window.localStorage.removeItem(k); } catch { /* ignore */ }
    }
    setSwrEntryCount(0);
    setJustCleared(`${toRemove.length} cached API response${toRemove.length === 1 ? "" : "s"}`);
    setTimeout(() => setJustCleared(null), 2500);
  }

  return (
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Settings · Privacy</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">
          What we store, what you control
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl text-sm">
          CommunitySafe is privacy-first by design. Nothing about you is sent to our server unless you take an explicit action (post, save an area, enable notifications). Everything else lives in your browser&apos;s local storage on this device only.
        </p>
      </header>

      {justCleared && (
        <p className="surface bg-sage-50 border border-sage-200 p-3 text-sm text-sage-700" role="status">
          Cleared: {justCleared}.
        </p>
      )}

      <section className="surface p-6 space-y-3">
        <h2 className="font-display text-xl text-slate2-900">What&apos;s stored on this device</h2>
        <p className="text-sm text-slate2-700">
          Each preference below sits in your browser&apos;s localStorage. Removing one resets that part of the app to its default. Clearing all preferences signs you out and forgets your city and area selection too.
        </p>
        <ul className="mt-3 divide-y divide-sand-200">
          {LOCAL_KEYS.map((e) => (
            <li key={e.key} className="py-2.5 flex items-baseline justify-between gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <p className="text-slate2-900">{e.label}</p>
                <p className="text-[11px] text-slate2-500 font-mono">{e.key}</p>
              </div>
              <span className={`text-xs ${present[e.key] ? "text-slate2-700" : "text-slate2-400"}`}>
                {present[e.key] ? "stored" : "not set"}
              </span>
              {present[e.key] && (
                <button
                  type="button"
                  onClick={() => clearOne(e.key, e.label)}
                  className="text-xs text-coral-700 hover:underline"
                >
                  Clear
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearAllPrefs}
            className="btn-secondary text-sm px-3 py-1.5"
          >
            Clear all saved preferences
          </button>
          <button
            type="button"
            onClick={clearSwrCache}
            className="btn-secondary text-sm px-3 py-1.5"
            disabled={swrEntryCount === 0}
          >
            Clear cached API responses ({swrEntryCount})
          </button>
        </div>
      </section>

      <section className="surface p-6 space-y-3">
        <h2 className="font-display text-xl text-slate2-900">Browser permissions</h2>
        <p className="text-sm text-slate2-700">
          These are granted at the browser level — CommunitySafe can only request them, your browser decides whether to honor the request. To change them, use your browser&apos;s site-settings page for this domain.
        </p>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate2-500">Notifications</dt>
            <dd className="text-slate2-900">
              {pushStatus === "granted" ? "Allowed" : pushStatus === "denied" ? "Blocked" : pushStatus === "default" ? "Not asked yet" : "Unsupported by this browser"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate2-500">Geolocation</dt>
            <dd className="text-slate2-900">Asked at use-time. We never request a background position.</dd>
          </div>
        </dl>
      </section>

      <LocationControls />

      <AppearanceControls />

      {/* "What we don't collect" closes the page after the controls. */}
      <section className="surface p-6 space-y-3 text-sm text-slate2-700">
        <h2 className="font-display text-xl text-slate2-900">What we don&apos;t collect</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>No tracking pixels, third-party analytics SDKs, or session-replay tools.</li>
          <li>No demographic columns from the police feeds we re-display — adapters explicitly enumerate which columns we read, and victim / suspect race / ethnicity / age / gender are never in that list.</li>
          <li>No location history. Geolocation is asked once per &ldquo;Use my location&rdquo; click and the coordinates are only used for the one resolver call to find your area.</li>
          <li>No correlation with other Anthropic or Vercel products.</li>
        </ul>
        <p className="text-[11px] text-slate2-500 leading-snug pt-2">
          For the full legal version, see{" "}
          <Link href="/privacy" className="text-bay-700 hover:underline">our privacy policy</Link>.
        </p>
      </section>
    </main>
  );
}

const PERSIST_AREA_KEY = "travelsafe.location.persistArea";
const PERSIST_CITY_KEY = "travelsafe.location.persistCity";

/// Granular controls for what CommunitySafe is allowed to remember about
/// your location across sessions. Browser permission state itself is
/// surfaced above — these toggles control what we DO with a grant.
///
/// Defaults: both ON (matches prior behavior, no breaking change).
/// Switching OFF clears the stored value AND prevents future writes
/// for the rest of the session; the underlying useArea / useCity
/// hooks fall back to in-memory state.
function LocationControls() {
  const [persistArea, setPersistAreaState] = useState<boolean>(true);
  const [persistCity, setPersistCityState] = useState<boolean>(true);

  useEffect(() => {
    try {
      const a = window.localStorage.getItem(PERSIST_AREA_KEY);
      const c = window.localStorage.getItem(PERSIST_CITY_KEY);
      // "false" string is the only off signal — anything else (including
      // null / never-set) means default ON.
      if (a === "false") setPersistAreaState(false);
      if (c === "false") setPersistCityState(false);
    } catch { /* ignore */ }
  }, []);

  function setPersistArea(next: boolean) {
    setPersistAreaState(next);
    try {
      window.localStorage.setItem(PERSIST_AREA_KEY, String(next));
      if (!next) {
        window.localStorage.removeItem("travelsafe.area.v1");
      }
    } catch { /* ignore */ }
  }

  function setPersistCity(next: boolean) {
    setPersistCityState(next);
    try {
      window.localStorage.setItem(PERSIST_CITY_KEY, String(next));
      if (!next) {
        window.localStorage.removeItem("travelsafe.city.v1");
      }
    } catch { /* ignore */ }
  }

  return (
    <section className="surface p-6 space-y-3">
      <h2 className="font-display text-xl text-slate2-900">Location controls</h2>
      <p className="text-sm text-slate2-700">
        CommunitySafe never tracks your live location. These switches control whether your <em>chosen</em> city and neighborhood are remembered between visits, or whether each session starts fresh.
      </p>
      <ul className="mt-3 divide-y divide-sand-200">
        <li className="py-3 flex items-baseline justify-between gap-3 text-sm">
          <div className="flex-1 min-w-0">
            <p className="text-slate2-900">Remember my city across sessions</p>
            <p className="text-xs text-slate2-500 mt-0.5">
              When off, the city header resets to the default on each visit. You can still pick a city — it just won&apos;t be remembered.
            </p>
          </div>
          <ToggleSwitch checked={persistCity} onChange={setPersistCity} label="Remember city" />
        </li>
        <li className="py-3 flex items-baseline justify-between gap-3 text-sm">
          <div className="flex-1 min-w-0">
            <p className="text-slate2-900">Remember my neighborhood across sessions</p>
            <p className="text-xs text-slate2-500 mt-0.5">
              When off, your neighborhood pick clears at the end of every browser session. Useful if you share this device or want a clean slate on each visit.
            </p>
          </div>
          <ToggleSwitch checked={persistArea} onChange={setPersistArea} label="Remember neighborhood" />
        </li>
      </ul>
      <p className="text-[11px] text-slate2-500 pt-1">
        Turning either off immediately clears the stored value. To revoke a browser-level geolocation grant entirely, use your browser&apos;s site-settings for this domain.
      </p>
    </section>
  );
}

/// Appearance — theme picker (light / dark / system). Stored in
/// localStorage; pre-paint script in the root layout applies the
/// effective class before React hydrates so dark-mode users don't
/// see a light-mode flash on cold loads.
function AppearanceControls() {
  const { theme, setTheme, effective } = useTheme();
  const options: Array<{ id: Theme; label: string; sublabel: string }> = [
    { id: "light",  label: "Light",  sublabel: "Calm, light palette" },
    { id: "dark",   label: "Dark",   sublabel: "Easier on the eyes after sundown" },
    { id: "system", label: "System", sublabel: "Follow your device's theme automatically" },
  ];
  return (
    <section className="surface p-6 space-y-3">
      <h2 className="font-display text-xl text-slate2-900">Appearance</h2>
      <p className="text-sm text-slate2-700">
        Choose how CommunitySafe looks. &ldquo;System&rdquo; follows your device&apos;s light/dark preference and updates live when you change it.
      </p>
      <div role="radiogroup" aria-label="App theme" className="mt-3 flex flex-wrap gap-1 text-sm">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={theme === o.id}
            onClick={() => setTheme(o.id)}
            title={o.sublabel}
            className={`px-3 py-1.5 rounded-md transition-colors font-medium ${
              theme === o.id ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate2-500 pt-1">
        Currently rendering: <strong className="text-slate2-700">{effective}</strong> mode.
      </p>
    </section>
  );
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
        checked ? "bg-bay-500" : "bg-sand-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
