import type { Metadata } from "next";
import Link from "next/link";
import { CITIES } from "@/server/services/crime-data/cities";
import { CityStatusInline } from "@/components/CityStatusInline";
import { LegalFooter } from "@/components/LegalFooter";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";

export const metadata: Metadata = {
  title: "All supported cities",
  description:
    "CommunitySafe surfaces neighborhood-level safety data for 44 US cities. Browse the full list and drill into any city's safety overview.",
  alternates: { canonical: "/cities" },
};

export const revalidate = 3600;

/// /cities — directory index of every supported city. Each link drops
/// the user on the city's landing page (/cities/<slug>) which then
/// fans into per-neighborhood pages. Optimized for search-engine
/// crawl: every link is a real anchor with descriptive text and the
/// metadata.alternates.canonical pins this URL as the master.
export default function CitiesIndexPage() {
  const sorted = [...CITIES].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Cities</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">
          {sorted.length} US cities covered
        </h1>
        <p className="mt-2 text-sm text-slate2-700 max-w-2xl">
          Pick a city to see neighborhood-level safety data drawn from that city&apos;s
          official police open-data feed, compared to the {FBI_DATA_LABEL}
          national average.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
        {sorted.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/cities/${c.slug}`}
              className="surface block px-3 py-2 hover:bg-bay-50 transition-colors"
            >
              <span className="block font-medium text-slate2-900">{c.label}</span>
              <CityStatusInline citySlug={c.slug} />
            </Link>
          </li>
        ))}
      </ul>

      <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">How this works:</strong>{" "}
        Each city page summarizes the police-feed coverage and links to the live
        Safety Index, Crime Map, Trend Feed, and Neighborhood Watch tabs. See{" "}
        <Link href="/coverage" className="text-bay-700 hover:underline">/coverage</Link>{" "}
        for live system status and{" "}
        <Link href="/methodology" className="text-bay-700 hover:underline">/methodology</Link>{" "}
        for how scores are computed.
      </p>

      {/* Fair Housing / lending / insurance / hiring disclaimer.
          Indexed SEO page must carry the same legal language the (app)
          layout DataDisclaimer provides on authenticated routes —
          otherwise a user landing from search sees scores without the
          guardrail. */}
      <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">How to read this:</strong>{" "}
        CommunitySafe summarizes publicly published police reports. Scores reflect
        historical reporting only — not predictions of future risk, and not a
        substitute for professional safety advice. These scores should not be used as the sole
        basis for housing, lending, insurance, or hiring decisions — verify each
        statistic with the cited official source before acting on it.
      </p>

      <LegalFooter />
    </main>
  );
}
