"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TabNav } from "@/components/TabNav";
import { CitySelector } from "@/components/CitySelector";
import { CityBackdrop } from "@/components/CityBackdrop";
import { isSignedIn, setToken } from "@/lib/api-client";

export default function AppLayout({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(isSignedIn()), []);

  function signOut() {
    setToken(null);
    setSignedIn(false);
  }

  return (
    <>
      <CityBackdrop />
      <header className="bg-white/80 backdrop-blur border-b border-sand-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-xl text-slate2-900 transition-colors hover:text-bay-700">
            <span className="bg-gradient-to-r from-bay-700 to-coral-500 bg-clip-text text-transparent">Travel</span>Safe
          </Link>
          <div className="flex items-center gap-2 text-xs text-slate2-500">
            <CitySelector />
            {signedIn && (
              <>
                <span className="text-sand-300">·</span>
                <button onClick={signOut} className="text-slate2-700 hover:text-bay-700 transition-colors">Sign out</button>
              </>
            )}
          </div>
        </div>
      </header>
      <TabNav />
      <div key={typeof window === "undefined" ? "ssr" : window.location.pathname} className="max-w-5xl mx-auto px-4 py-8 animate-fade-in">
        {children}
      </div>
    </>
  );
}
