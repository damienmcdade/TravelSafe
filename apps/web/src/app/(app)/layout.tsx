"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TabNav } from "@/components/TabNav";
import { DemoDataBanner } from "@/components/DemoDataBanner";
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
      <DemoDataBanner />
      <header className="bg-white/80 backdrop-blur border-b border-sand-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-display text-xl text-slate2-900 transition-colors hover:text-bay-700">
            <span className="bg-gradient-to-r from-bay-700 to-coral-500 bg-clip-text text-transparent">Travel</span>Safe
          </Link>
          <div className="flex items-center gap-3 text-xs text-slate2-500">
            <span className="hidden sm:inline">San Diego, CA</span>
            <span className="text-sand-300 hidden sm:inline">·</span>
            {signedIn ? (
              <button onClick={signOut} className="text-slate2-700 hover:text-bay-700 transition-colors">Sign out</button>
            ) : (
              <Link href="/login" className="text-slate2-700 hover:text-bay-700 transition-colors">Sign in</Link>
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
