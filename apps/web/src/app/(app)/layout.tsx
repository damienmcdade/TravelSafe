"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { TabNav } from "@/components/TabNav";
import { CitySelector } from "@/components/CitySelector";
import { AIAssistant } from "@/components/AIAssistant";
import { SavedAreasRail } from "@/components/SavedAreasRail";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* No sign-in / sign-out controls: every device is automatically issued
          an anonymous session by SessionBootstrap (mounted in the root layout).
          Browsing, posting, check-in timer, and live-share all work with no
          visible account flow. */}
      <header className="bg-white/80 backdrop-blur border-b border-sand-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-xl text-slate2-900 transition-colors hover:text-bay-700">
            <span className="bg-gradient-to-r from-bay-700 to-coral-500 bg-clip-text text-transparent">Travel</span>Safe
          </Link>
          <div className="flex items-center gap-2 text-xs text-slate2-500">
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
      <main
        id="main"
        key={typeof window === "undefined" ? "ssr" : window.location.pathname}
        className="max-w-5xl mx-auto px-4 py-8 animate-fade-in space-y-4"
      >
        <SavedAreasRail />
        {children}
      </main>
      <footer className="mt-12 border-t border-sand-200 bg-white/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate2-500">
          <p>
            TravelSafe surfaces official city police-incident data and the FBI Crime in the Nation 2024 national rate.
            Historical reporting only — not a substitute for emergency services.
          </p>
          <nav aria-label="Legal" className="flex gap-3">
            <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link>
            <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link>
            <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>
          </nav>
        </div>
      </footer>
      <AIAssistant />
    </>
  );
}
