"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";

// Top-level tabs. Crime Map / Neighborhood Watch / Personal Safety stand on
// their own — they used to be grouped under SafeZone but the grouping added
// a click without earning it. SafeZone now only holds the two newer subtabs
// (Safety Score + Trend Feed), so its entry route is /safety-score.
interface TabDef {
  href: string;
  label: string;
  subroutes: string[];
  /// API paths to pre-warm when the user hovers over this tab. Each is
  /// fired as a `fetch()` (no body parsed) so the response lands in the
  /// browser HTTP cache before the click. Vercel's edge cache (s-maxage
  /// on the routes) makes these near-free for repeat hovers.
  warm?: (ctx: { citySlug: string; areaSlug: string | null }) => string[];
}

const TABS: TabDef[] = [
  { href: "/threats", label: "Awareness", subroutes: [],
    warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
  { href: "/map", label: "Crime Map", subroutes: [],
    warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
  { href: "/watch", label: "Neighborhood Watch", subroutes: [],
    warm: ({ citySlug }) => [`/api/geo/areas?city=${citySlug}`] },
  { href: "/safety", label: "Personal Safety", subroutes: [] },
  { href: "/safety-score", label: "SafeZone", subroutes: ["/safety-score", "/trends"],
    warm: ({ citySlug, areaSlug }) => areaSlug
      ? [`/api/safezone/safety-score?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`,
         `/api/safezone/trend?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`]
      : [`/api/safezone/safety-score?city=${citySlug}`, `/api/safezone/trend?city=${citySlug}`] },
  { href: "/route", label: "Safe Route", subroutes: [],
    warm: ({ citySlug }) => [`/api/geo/areas?city=${citySlug}`] },
  { href: "/community", label: "CommunitySafe", subroutes: [] },
];

/// One-shot fetch with a short timeout so a hover that never converts to
/// a click doesn't leak a long-running request. Errors are swallowed —
/// this is best-effort warming.
function warmFetch(path: string) {
  if (typeof window === "undefined") return;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    void fetch(path, { signal: ctrl.signal, credentials: "same-origin" }).catch(() => {});
  } catch { /* ignore */ }
}

export function TabNav() {
  const pathname = usePathname();
  const { city } = useCity();
  const { area } = useArea(city.slug);
  return (
    <nav className="border-b border-sand-200 bg-white/80 backdrop-blur sticky top-0 z-20">
      <ul className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
        {TABS.map((t) => {
          // Active when the user is on the tab's own href OR any of its
          // sub-routes — so SafeZone stays highlighted across all 3 subtabs.
          const active = pathname?.startsWith(t.href) ||
            t.subroutes.some((r) => pathname?.startsWith(r));
          const onPreload = t.warm
            ? () => {
                const paths = t.warm!({ citySlug: city.slug, areaSlug: area?.slug ?? null });
                for (const p of paths) warmFetch(p);
              }
            : undefined;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`tab-link ${active ? "is-active text-slate2-900 font-medium" : "text-slate2-500 hover:text-bay-700"}`}
                onMouseEnter={onPreload}
                onFocus={onPreload}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
