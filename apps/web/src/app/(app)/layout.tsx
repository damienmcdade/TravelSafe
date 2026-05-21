"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TabNav } from "@/components/TabNav";
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
      <header className="bg-white border-b border-sand-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-display text-xl text-slate2-900">TravelSafe</Link>
          <div className="flex items-center gap-3 text-xs text-slate2-500">
            <span>San Diego, CA</span>
            <span className="text-sand-300">·</span>
            {signedIn ? (
              <button onClick={signOut} className="text-slate2-700 hover:underline">Sign out</button>
            ) : (
              <Link href="/login" className="text-slate2-700 hover:underline">Sign in</Link>
            )}
          </div>
        </div>
      </header>
      <TabNav />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </>
  );
}
