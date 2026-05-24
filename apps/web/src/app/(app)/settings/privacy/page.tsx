"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useDocumentTitle } from "@/lib/use-document-title";

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
          TravelSafe is privacy-first by design. Nothing about you is sent to our server unless you take an explicit action (post, save an area, enable notifications). Everything else lives in your browser&apos;s local storage on this device only.
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
          These are granted at the browser level — TravelSafe can only request them, your browser decides whether to honor the request. To change them, use your browser&apos;s site-settings page for this domain.
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
