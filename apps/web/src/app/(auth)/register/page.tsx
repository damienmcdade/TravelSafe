"use client";
import Link from "next/link";

// Account creation has been removed from the public flow. The /register URL
// stays mounted (existing links don't 404) but it now explains that the
// application no longer accepts new account creation, and points users at
// the anonymous community feed.
export default function RegisterPage() {
  return (
    <main className="max-w-md mx-auto px-6 py-16 animate-rise-in">
      <h1 className="font-display text-3xl text-slate2-900">Account creation is closed</h1>
      <p className="mt-3 text-slate2-700 text-sm">
        New accounts are no longer needed. CommunitySafe accepts anonymous posts (only profanity and threats are blocked), and the Crime Map, Awareness, and Neighborhood Watch tabs are all open to browse without signing in.
      </p>
      <p className="mt-3 text-slate2-700 text-sm">
        If you previously created an account, you can still <Link className="underline hover:text-bay-700 transition-colors" href="/login">sign in</Link> to access the check-in timer and live-share tools.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/threats" className="btn-primary">Browse {/* dynamic city label lives in the awareness page */}safety data</Link>
        <Link href="/community" className="btn-secondary">Post anonymously</Link>
      </div>
    </main>
  );
}
