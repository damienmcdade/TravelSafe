"use client";
import { useEffect } from "react";

/// App Router error boundary for every page under (app). If a client
/// component throws during render or an unhandled promise bubbles up,
/// React renders this fallback instead of a blank page. The reset()
/// callback re-attempts the failed render so transient errors (a flaky
/// fetch, a hydration glitch on a stale tab) clear with one tap.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface in the console so devs can find the cause; production
    // exceptions also propagate to Vercel's error stream.
     
    console.error("[CommunitySafe] page error:", error);
  }, [error]);

  return (
    <div className="space-y-4 p-6 max-w-2xl mx-auto">
      <section className="surface p-6 border-amber2-500/40">
        <p className="text-xs uppercase tracking-[0.18em] text-amber2-700 font-medium">Something went wrong</p>
        <h1 className="mt-1 font-display text-2xl text-slate2-900">This page hit an error</h1>
        <p className="mt-2 text-sm text-slate2-700 leading-snug">
          CommunitySafe couldn&apos;t render this view just now. The underlying police feed may be slow or
          the cached response could be malformed. Tap below to retry; if it keeps failing, switch
          to a different tab and come back.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => reset()} className="btn-primary text-sm px-4 py-1.5">
            Retry
          </button>
          <a href="/city" className="btn-secondary text-sm px-4 py-1.5">
            Back to Awareness
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-[11px] text-slate2-500 font-mono">ref: {error.digest}</p>
        )}
      </section>
    </div>
  );
}
