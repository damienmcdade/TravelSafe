"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";

/// IA v3: 4 primary destinations + a "More" drawer for utilities.
///
///   /now   — what's happening right now (city + neighborhood, scrollable)
///   /plan  — investigate one area or plan a trip (Safety Score + Route)
///   /act   — take action (Personal Safety + Community posts)
///   /map   — full-bleed geographic exploration
///
/// Drawer (less-used): Coverage, Neighborhood Watch, Cities directory,
/// Privacy controls. These exist but don't earn primary-nav space.
///
/// Replaces the prior 3-workflow + 9-sub-tab structure which made the
/// app feel deeper than it actually is and forced users to remember
/// which workflow held each feature.
interface TabDef {
  href: string;
  label: string;
  /// Optional shorter label for narrow viewports — full label otherwise
  /// pushes 4 tabs (~800px) past a 375px phone width.
  mobileLabel?: string;
  /// Other route prefixes that should keep this tab marked active.
  subroutes?: string[];
  /// API paths to pre-warm when the user hovers over this tab.
  warm?: (ctx: { citySlug: string; areaSlug: string | null }) => string[];
}

// Tab labels per the v6 IA decision:
//   1. City Awareness         — citywide-only cards
//   2. Neighborhood Awareness — area cards + Personal Safety sub-tab
//   3. Overwatch              — Crime Map + Safe Route sub-tabs
//   4. CommunitySafe          — standalone
//
// Vigilance retired (Personal Safety moved into Neighborhood Awareness
// as a sub-tab). Crime Map and Safe Route relocated into Overwatch.
// More drawer removed — Coverage/Watch/Cities/Privacy still exist as
// direct URLs but no longer surface in the primary nav.
const PRIMARY: TabDef[] = [
  // City Awareness — citywide-only cards. Subroute hints preserve
  // bookmarks from previous IA iterations. Mobile label drops the
  // redundant "Awareness" to fit 4 tabs at 375px.
  { href: "/city", label: "City Awareness", mobileLabel: "City",
    subroutes: ["/now", "/threats", "/safety-score", "/trends"],
    warm: ({ citySlug }) => [
      `/api/crime-data/citywide?city=${citySlug}`,
      `/api/safezone/safety-score?city=${citySlug}`,
    ] },
  // Neighborhood Awareness — search + area cards + Personal Safety
  // sub-tab. /safety / /vigilance legacy URLs light up this tab.
  { href: "/neighborhood", label: "Neighborhood Awareness", mobileLabel: "Area",
    subroutes: ["/safety", "/vigilance"],
    warm: ({ citySlug, areaSlug }) => areaSlug
      ? [`/api/safezone/safety-score?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`]
      : [`/api/geo/areas?city=${citySlug}`] },
  // Pathfinder — Crime Map + Safe Route in one hub.
  { href: "/overwatch", label: "Pathfinder", mobileLabel: "Pathfinder",
    subroutes: ["/map", "/route", "/plan"],
    warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
  // Connections — community feed.
  { href: "/community", label: "Connections", mobileLabel: "Connect",
    subroutes: ["/act"] },
];

// Drawer routes still exist as deep links but no longer surface in
// the primary nav per the v6 directive ("remove More button"). Listed
// here as documentation of what's reachable by URL.
//   /coverage           — Coverage & data health
//   /watch              — Neighborhood Watch
//   /cities             — Cities directory
//   /settings/privacy   — Privacy controls

function isTabActive(tab: TabDef, pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === tab.href) return true;
  if (pathname.startsWith(tab.href + "/")) return true;
  return (tab.subroutes ?? []).some((r) => pathname === r || pathname.startsWith(r + "/"));
}

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

  // v99 — solid bg (no backdrop-blur) below. This sticky nav sits directly
  // under the also-sticky, also-blurred app header; stacking two
  // backdrop-blur layers forced the browser to re-sample/blur the moving
  // content twice per scroll frame (a known mobile-WebView scroll-stutter
  // source). The header keeps its frosted look; this bar is opaque, which
  // removes the second blur pass.
  return (
    <nav className="border-b border-sand-200 bg-white/95 sticky top-0 z-20" aria-label="Primary">
      <div className="relative">
        <ul className="max-w-5xl mx-auto flex items-stretch gap-1 px-4 py-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]">
          {PRIMARY.map((t) => {
            const active = isTabActive(t, pathname);
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
                  aria-label={t.label}
                  title={t.label}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm rounded-md transition-all whitespace-nowrap ${
                    active
                      ? "bg-bay-500 text-white font-semibold shadow-card"
                      : "text-slate2-700 hover:text-bay-700 hover:bg-sand-100/80"
                  }`}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={onPreload}
                  onFocus={onPreload}
                >
                  {/* Short label on mobile, full label on sm+ — long
                      labels like "Neighborhood Awareness" would push
                      4 tabs past a 375px viewport. Title attribute
                      surfaces the full label on hover for desktop. */}
                  <span className="sm:hidden">{t.mobileLabel ?? t.label}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="pointer-events-none absolute top-0 right-0 h-full w-6 bg-gradient-to-l from-white/90 to-transparent sm:hidden" aria-hidden />
      </div>
    </nav>
  );
}
