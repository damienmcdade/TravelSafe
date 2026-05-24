"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  /// Other route prefixes that should keep this tab marked active.
  subroutes?: string[];
  /// API paths to pre-warm when the user hovers over this tab.
  warm?: (ctx: { citySlug: string; areaSlug: string | null }) => string[];
}

const PRIMARY: TabDef[] = [
  // /now — unified Awareness (replaces /threats City+Neighborhood toggle)
  { href: "/now", label: "Now",
    subroutes: ["/threats"],
    warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
  // /plan — Safety Score + Trend + Compare + Route. Subroutes cover the
  // legacy URLs so a bookmark to /safety-score still highlights this tab.
  { href: "/plan", label: "Plan",
    subroutes: ["/safety-score", "/trends", "/route"],
    warm: ({ citySlug, areaSlug }) => areaSlug
      ? [`/api/safezone/safety-score?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`,
         `/api/safezone/trend?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`]
      : [`/api/safezone/safety-score?city=${citySlug}`,
         `/api/safezone/trend?city=${citySlug}`] },
  // /act — Personal Safety + Community
  { href: "/act", label: "Act",
    subroutes: ["/safety", "/community"] },
  // /map — geographic exploration
  { href: "/map", label: "Map",
    warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
];

const DRAWER: TabDef[] = [
  { href: "/coverage", label: "Coverage & data health" },
  { href: "/watch",    label: "Neighborhood Watch" },
  { href: "/cities",   label: "Cities directory" },
  { href: "/settings/privacy", label: "Privacy controls" },
];

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLLIElement | null>(null);

  // Close drawer on route change.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Outside-click closer for the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    function onClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setDrawerOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [drawerOpen]);

  // Escape closer.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setDrawerOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const drawerActive = DRAWER.some((t) => isTabActive(t, pathname));

  return (
    <nav className="border-b border-sand-200 bg-white/80 backdrop-blur sticky top-0 z-20" aria-label="Primary">
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
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? "text-slate2-900 font-semibold bg-sand-50 ring-1 ring-sand-200"
                      : "text-slate2-500 hover:text-bay-700 hover:bg-sand-50/60"
                  }`}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={onPreload}
                  onFocus={onPreload}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
          {/* More drawer */}
          <li className="relative ml-auto" ref={drawerRef}>
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-expanded={drawerOpen}
              aria-haspopup="menu"
              aria-label="More"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap ${
                drawerActive || drawerOpen
                  ? "text-slate2-900 font-semibold bg-sand-50 ring-1 ring-sand-200"
                  : "text-slate2-500 hover:text-bay-700 hover:bg-sand-50/60"
              }`}
            >
              <span aria-hidden>⋯</span>
              <span className="sr-only sm:not-sr-only">More</span>
            </button>
            {drawerOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-30 surface shadow-card-lift p-1 min-w-[12rem]"
              >
                {DRAWER.map((t) => {
                  const active = isTabActive(t, pathname);
                  return (
                    <Link
                      key={t.href}
                      role="menuitem"
                      href={t.href}
                      className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                        active ? "bg-bay-100 text-slate2-900 font-medium" : "text-slate2-700 hover:bg-sand-100"
                      }`}
                    >
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </li>
        </ul>
        <div className="pointer-events-none absolute top-0 right-0 h-full w-6 bg-gradient-to-l from-white/90 to-transparent sm:hidden" aria-hidden />
      </div>
    </nav>
  );
}
