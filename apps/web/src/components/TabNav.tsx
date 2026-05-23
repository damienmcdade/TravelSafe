"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";

/// IA: 3 top-level workflows organized by USER INTENT, each with a
/// sub-nav of routes inside. Replaces the prior flat 7-tab strip which
/// duplicated cards across tabs and made the same data show up in two
/// places (Awareness + CommunitySafe both rendering NewsPanel + crime
/// mix, for instance).
///
///   Browse      — citywide overview, news, system status, directory
///   Investigate — single-area deep-dive: score / trends / watch / map
///   Act         — live tools that take user action
interface TabDef {
  href: string;
  label: string;
  /// Other route prefixes that should keep this tab marked active
  /// (e.g. /trends keeps /safety-score active when we use safety-score
  /// as the SafeZone entry point).
  subroutes?: string[];
  /// API paths to pre-warm when the user hovers over this tab. Each
  /// becomes a `fetch()` (no body parsed) so the response lands in the
  /// browser HTTP cache before the click. Vercel's edge cache makes
  /// these near-free for repeat hovers.
  warm?: (ctx: { citySlug: string; areaSlug: string | null }) => string[];
}

interface WorkflowDef {
  id: "browse" | "investigate" | "act";
  label: string;
  tagline: string;
  tabs: TabDef[];
}

const WORKFLOWS: WorkflowDef[] = [
  {
    id: "browse",
    label: "Browse",
    tagline: "Overview, news, and system status",
    tabs: [
      { href: "/threats", label: "Awareness",
        warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
      { href: "/community", label: "Community" },
      { href: "/coverage", label: "Coverage" },
      { href: "/cities", label: "All cities" },
    ],
  },
  {
    id: "investigate",
    label: "Investigate",
    tagline: "Deep-dive on one area: score, trends, map, watch",
    tabs: [
      // SafeZone (Score + Trends) — one tab, one page. The /trends
      // URL still works as an alias for SEO/bookmarks, but the
      // Investigate sub-nav advertises a single SafeZone entry to
      // avoid the "two tabs, same product" confusion the old IA had.
      { href: "/safety-score", label: "SafeZone", subroutes: ["/trends"],
        warm: ({ citySlug, areaSlug }) => areaSlug
          ? [`/api/safezone/safety-score?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`,
             `/api/safezone/trend?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaSlug)}`]
          : [`/api/safezone/safety-score?city=${citySlug}`,
             `/api/safezone/trend?city=${citySlug}`] },
      { href: "/watch", label: "Neighborhood Watch",
        warm: ({ citySlug }) => [`/api/geo/areas?city=${citySlug}`] },
      { href: "/map", label: "Crime Map",
        warm: ({ citySlug }) => [`/api/crime-data/citywide?city=${citySlug}`] },
    ],
  },
  {
    id: "act",
    label: "Act",
    tagline: "Live tools: routing + personal safety",
    tabs: [
      { href: "/route", label: "Safe Route",
        warm: ({ citySlug }) => [`/api/geo/areas?city=${citySlug}`] },
      { href: "/safety", label: "Personal Safety" },
    ],
  },
];

/// Default workflow when the path doesn't match any tab (e.g. a /cities/[slug]
/// SEO page lands here — Browse is the right context for that).
const DEFAULT_WORKFLOW: WorkflowDef["id"] = "browse";

function isTabActive(tab: TabDef, pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === tab.href) return true;
  if (pathname.startsWith(tab.href + "/")) return true;
  return (tab.subroutes ?? []).some((r) => pathname === r || pathname.startsWith(r + "/"));
}

function activeWorkflow(pathname: string | null): WorkflowDef {
  for (const w of WORKFLOWS) {
    if (w.tabs.some((t) => isTabActive(t, pathname))) return w;
  }
  return WORKFLOWS.find((w) => w.id === DEFAULT_WORKFLOW) ?? WORKFLOWS[0];
}

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
  const current = activeWorkflow(pathname);

  return (
    <nav className="border-b border-sand-200 bg-white/80 backdrop-blur sticky top-0 z-20" aria-label="Primary">
      {/* Row 1: workflow tabs (top-level intent) */}
      <ul className="max-w-5xl mx-auto flex gap-1 px-4 pt-1 overflow-x-auto">
        {WORKFLOWS.map((w) => {
          const isActive = w.id === current.id;
          // Land users on the FIRST tab of the chosen workflow.
          const href = w.tabs[0]?.href ?? "/";
          return (
            <li key={w.id}>
              <Link
                href={href}
                className={`inline-flex items-baseline gap-1.5 px-3 py-2 text-sm rounded-t-md transition-colors ${
                  isActive
                    ? "text-slate2-900 font-semibold bg-sand-50 border-x border-t border-sand-200"
                    : "text-slate2-500 hover:text-bay-700"
                }`}
                aria-current={isActive ? "page" : undefined}
                title={w.tagline}
              >
                {w.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Row 2: sub-nav for the active workflow */}
      <ul className="max-w-5xl mx-auto flex gap-0.5 px-4 py-1 overflow-x-auto text-xs border-t border-sand-100">
        {current.tabs.map((t) => {
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
                className={`tab-link ${active ? "is-active text-slate2-900 font-medium" : "text-slate2-500 hover:text-bay-700"}`}
                aria-current={active ? "page" : undefined}
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
