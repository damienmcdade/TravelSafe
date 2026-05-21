"use client";
import { useEffect, useState } from "react";
import { isDemoModeActive, subscribeDemoMode } from "@/lib/api-client";

export function DemoDataBanner() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(isDemoModeActive());
    const unsub = subscribeDemoMode(setActive);
    return () => { unsub(); };
  }, []);
  if (!active) return null;
  return (
    <div className="bg-coral-200 text-coral-700 text-xs">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2 animate-fade-in">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-coral-500 animate-pulse" />
        <span>
          <strong>Demo data.</strong> The TravelSafe API isn&apos;t reachable from this browser — showing bundled samples.
          Set <code className="bg-white/50 px-1 rounded">NEXT_PUBLIC_API_BASE_URL</code> on Vercel and confirm the Railway API is live to see real San Diego data.
        </span>
      </div>
    </div>
  );
}
