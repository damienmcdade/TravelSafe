"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level tabs. The three safety-oriented routes (Crime Map, Neighborhood
// Watch, Personal Safety) are grouped under a single "SafeZone" parent tab
// — clicking it lands on the Crime Map by default, and a sub-nav inside
// each of the three pages lets the user move between the siblings without
// a full page change. We keep the underlying routes (/map, /watch, /safety)
// so deep links and browser history stay clean.
const TABS = [
  { href: "/threats",      label: "Awareness",     subroutes: [] as string[] },
  { href: "/map",          label: "SafeZone",      subroutes: ["/map", "/watch", "/safety", "/safety-score", "/trends"] },
  { href: "/route",        label: "Safe Route",    subroutes: [] },
  { href: "/community",    label: "CommunitySafe", subroutes: [] },
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
