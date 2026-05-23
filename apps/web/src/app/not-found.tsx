import Link from "next/link";
import type { Metadata } from "next";

/// Root-level 404. Catches any URL that doesn't match a route — including
/// /cities/<unsupported-slug>, /old-bookmark, and direct hits on routes
/// that were renamed. Branded to match the rest of the app and offers
/// concrete next steps (home, supported cities, coverage map) rather
/// than the bare Next.js default that just says "404".

export const metadata: Metadata = {
  title: "Page not found",
  // Tell crawlers not to keep the 404 in their index. Next sets
  // `X-Robots-Tag: noindex` automatically for not-found responses,
  // but the inline meta tag is belt-and-braces for older bots.
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="space-y-4 p-6 max-w-2xl mx-auto">
      <section className="surface p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">404</p>
        <h1 className="mt-1 font-display text-2xl text-slate2-900">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm text-slate2-700 leading-snug">
          The URL you opened isn&apos;t a TravelSafe route. It may have been moved or the link
          may have a typo. Here&apos;s where you can go from here:
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          <li>
            <Link href="/" className="btn-primary block text-sm px-4 py-2 text-center">Home</Link>
          </li>
          <li>
            <Link href="/cities" className="btn-secondary block text-sm px-4 py-2 text-center">Supported cities</Link>
          </li>
          <li>
            <Link href="/coverage" className="btn-secondary block text-sm px-4 py-2 text-center">Coverage &amp; system status</Link>
          </li>
          <li>
            <Link href="/methodology" className="btn-secondary block text-sm px-4 py-2 text-center">How TravelSafe works</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
