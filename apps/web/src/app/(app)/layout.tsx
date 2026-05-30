// v99 — Server Component. The shell chrome (header, tab nav, footer, skip
// link) is static and now renders on the server, shipping no JS for itself;
// the interactive pieces below (CitySelector, TabNav, ThemeToggle,
// AIAssistant, SavedAreasRail) remain their own client islands. The only
// client-dependent bit — re-keying <main> per route for the fade animation —
// lives in the <AnimatedMain> island. Pre-v99 the whole layout was
// "use client" solely to read window.location.pathname for that key.
import type { ReactNode } from "react";
import Link from "next/link";
import { TabNav } from "@/components/TabNav";
import { CitySelector } from "@/components/CitySelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AIAssistant } from "@/components/AIAssistant";
import { SavedAreasRail } from "@/components/SavedAreasRail";
import { DataDisclaimer } from "@/components/DataDisclaimer";
import { AnimatedMain } from "@/components/AnimatedMain";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* No sign-in / sign-out controls: every device is automatically issued
          an anonymous session by SessionBootstrap (mounted in the root layout).
          Browsing, posting, check-in timer, and live-share all work with no
          visible account flow. */}
      <header className="bg-white/80 backdrop-blur border-b border-sand-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2 sm:gap-3">
          <Link
            href="/"
            className="font-display text-xl text-slate2-900 transition-colors hover:text-bay-700 shrink-0 min-w-0 truncate"
          >
            <span className="bg-gradient-to-r from-bay-700 to-coral-500 bg-clip-text text-transparent">Community</span>Safe
          </Link>
          {/* Right-cluster: ThemeToggle on desktop, single CitySelector
              everywhere. v45 — the standalone StateSelector pill is
              removed; state lives as the first wheel inside the
              CitySelector dropdown (now a 3-wheel State + City +
              Neighborhood picker). Resolves the user-reported lockout
              where picking a state auto-committed the first city and
              users couldn't choose a different one without manually
              hunting through the global city list. */}
          <div className="flex items-center gap-2 text-xs text-slate2-500 min-w-0">
            <div className="hidden sm:inline-flex">
              <ThemeToggle align="right" size="sm" />
            </div>
            <CitySelector />
          </div>
        </div>
      </header>
      <TabNav />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-bay-500 focus:text-white focus:px-3 focus:py-2 focus:rounded-md focus:shadow-card"
      >
        Skip to main content
      </a>
      <AnimatedMain>
        <SavedAreasRail />
        {children}
        {/* Single-mount DataDisclaimer for the entire (app) shell —
            previously every tab imported and rendered its own copy.
            Lifting it here means the legal "historical reporting only,
            not for housing/lending/insurance/hiring decisions" notice
            is shown on every authenticated page exactly once, and a
            future copy change touches one file instead of seven. */}
        <DataDisclaimer prefix="How to read this:" />
      </AnimatedMain>
      <footer className="mt-12 border-t border-sand-200 bg-white/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate2-500">
          <p>
            CommunitySafe surfaces official city police-incident data and the {FBI_DATA_LABEL} national rate.
            Historical reporting only — not a substitute for emergency services.
          </p>
          <nav aria-label="Legal" className="flex gap-3 flex-wrap">
            <Link href="/coverage" className="text-bay-700 hover:underline">Coverage</Link>
            <Link href="/watch" className="text-bay-700 hover:underline">Watch</Link>
            <Link href="/cities" className="text-bay-700 hover:underline">Cities</Link>
            <Link href="/settings/privacy" className="text-bay-700 hover:underline">Settings</Link>
            <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link>
            <Link href="/credits" className="text-bay-700 hover:underline">Photo credits</Link>
            <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link>
            <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>
          </nav>
        </div>
      </footer>
      <AIAssistant />
    </>
  );
}
