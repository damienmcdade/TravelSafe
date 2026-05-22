"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/// Subtabs that live inside the top-level SafeZone tab. Each subtab is its
/// own route so deep links + browser back/forward work cleanly; this nav
/// just renders the three sibling routes with active-state styling.
///
/// The three subtabs span the full "what-to-know / what-to-do" loop:
///   Crime Map         — where reported crime has clustered (city-wide view)
///   Neighborhood Watch — what your neighborhood specifically should know
///   Personal Safety   — concrete tools (check-in timer, live share, tips)
const SUBTABS = [
  { href: "/map",          label: "Crime Map",         hint: "City-wide polygon view" },
  { href: "/watch",        label: "Neighborhood Watch", hint: "Tailored cards per area" },
  { href: "/safety-score", label: "Safety Score",      hint: "Area vs FBI national" },
  { href: "/trends",       label: "Trend Feed",        hint: "30-day rolling timeline" },
  { href: "/safety",       label: "Personal Safety",    hint: "Check-in, share, tips" },
];

export function SafeZoneSubNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="SafeZone subtabs" className="surface p-2 flex flex-wrap gap-1">
      {SUBTABS.map((t) => {
        const active = pathname?.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex-1 min-w-[10rem] px-3 py-2 rounded-lg text-sm transition-colors text-center ${
              active
                ? "bg-bay-500 text-white shadow-card"
                : "text-slate2-700 hover:bg-bay-50 hover:text-bay-700"
            }`}
          >
            <div className="font-medium">{t.label}</div>
            <div className={`text-[10px] mt-0.5 ${active ? "text-white/80" : "text-slate2-500"}`}>{t.hint}</div>
          </Link>
        );
      })}
    </nav>
  );
}
