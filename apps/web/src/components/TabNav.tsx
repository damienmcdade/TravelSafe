"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level tabs. Crime Map / Neighborhood Watch / Personal Safety stand on
// their own — they used to be grouped under SafeZone but the grouping added
// a click without earning it. SafeZone now only holds the two newer subtabs
// (Safety Score + Trend Feed), so its entry route is /safety-score.
const TABS = [
  { href: "/threats",       label: "Awareness",        subroutes: [] as string[] },
  { href: "/map",           label: "Crime Map",        subroutes: [] },
  { href: "/watch",         label: "Neighborhood Watch", subroutes: [] },
  { href: "/safety",        label: "Personal Safety",  subroutes: [] },
  { href: "/safety-score",  label: "SafeZone",         subroutes: ["/safety-score", "/trends"] },
  { href: "/route",         label: "Safe Route",       subroutes: [] },
  { href: "/community",     label: "CommunitySafe",    subroutes: [] },
];

export function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-sand-200 bg-white/80 backdrop-blur sticky top-0 z-20">
      <ul className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
        {TABS.map((t) => {
          // Active when the user is on the tab's own href OR any of its
          // sub-routes — so SafeZone stays highlighted across all 3 subtabs.
          const active = pathname?.startsWith(t.href) ||
            t.subroutes.some((r) => pathname?.startsWith(r));
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`tab-link ${active ? "is-active text-slate2-900 font-medium" : "text-slate2-500 hover:text-bay-700"}`}
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
