import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CITIES, cityBySlug } from "@/server/services/crime-data/cities";
import { getCitywideSafetyScore } from "@/server/services/watch/safety-score";
import { CityCompare } from "@/components/CityCompare";

interface Props {
  params: Promise<{ city: string }>;
}

// v63 hotfix — excluded slow-cold-cache cities from static generation.
// Cleveland's bounded-concurrency adapter fetch (added in v63 after the
// 30-parallel rate-limit fix) takes ~5min cold, which blows Vercel's
// 60s static-generation timeout — three retries all failed and the
// whole production build errored on /cities/cleveland. These cities
// render on-demand via ISR (revalidate=300, in line with the API
// route Cache-Control) so the first user pays the cold-fetch wait
// but every subsequent hit serves from edge cache.
const DYNAMIC_ONLY_CITIES = new Set(["cleveland"]);
export function generateStaticParams() {
  return CITIES.filter((c) => !DYNAMIC_ONLY_CITIES.has(c.slug))
    .map((c) => ({ city: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = cityBySlug(slug);
  if (!city) return { title: "City not found" };
  return {
    title: `${city.label} safety overview`,
    description: `Neighborhood-level safety data for ${city.label} — official police-feed coverage compared to the FBI Crime Data Explorer 2025 national average.`,
    alternates: { canonical: `/cities/${slug}` },
    openGraph: {
      title: `${city.label} safety overview · CommunitySafe`,
      description: `Browse every supported ${city.label} neighborhood with a current Safety Index and recent reports timeline. Data sourced directly from the city's official police open-data feed.`,
      type: "article",
    },
  };
}

// 5-minute ISR — was 3600s but Cleveland (now dynamic, no static
// pre-render) reads via this revalidate cadence on edge cache, and
// 5 min matches the underlying adapter cache TTL so users see fresh
// data the moment it lands without waiting an hour.
export const revalidate = 300;

export default async function CityLandingPage({ params }: Props) {
  const { city: slug } = await params;
  const city = cityBySlug(slug);
  if (!city) notFound();

  const [areas, citywideScore] = await Promise.all([
    city.discover().catch(() => []),
    getCitywideSafetyScore(slug).catch(() => null),
  ]);

  // JSON-LD structured data. Schema.org Place + BreadcrumbList lets
  // search engines understand the page as a location overview and
  // surface rich snippets (breadcrumb chips, citywide metadata) in
  // results. Inlined as a single <script> in the page body so it
  // ships with the SSR HTML — no extra round trip.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Place",
        name: city.label,
        url: `${base}/cities/${slug}`,
        description: `Neighborhood-level safety data for ${city.label}, sourced from the official ${city.label} police open-data feed.`,
        geo: {
          "@type": "GeoCoordinates",
          latitude: city.bbox ? (city.bbox.south + city.bbox.north) / 2 : undefined,
          longitude: city.bbox ? (city.bbox.west + city.bbox.east) / 2 : undefined,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Cities", item: `${base}/cities` },
          { "@type": "ListItem", position: 2, name: city.label, item: `${base}/cities/${slug}` },
        ],
      },
    ],
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav aria-label="Breadcrumb" className="text-xs text-slate2-500">
        <Link href="/cities" className="text-bay-700 hover:underline">Cities</Link>
        {" / "}
        <span>{city.label}</span>
      </nav>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">City overview</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">{city.label}</h1>
        <p className="mt-2 text-sm text-slate2-700 max-w-2xl">
          {areas.length > 0
            ? `${areas.length.toLocaleString()} neighborhoods covered by the ${city.label} police open-data feed. Browse a specific area below or jump into the live app.`
            : `${city.label} adapter is still being wired up. We list the city here so the coverage is transparent — live data is on the roadmap.`}
        </p>
      </header>

      {citywideScore && (
        <section className="surface p-5 sm:p-6">
          <h2 className="font-display text-xl text-slate2-900">Citywide Safety Index</h2>
          <div className="mt-3 flex items-center gap-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl ring-2 ring-bay-200 bg-white text-3xl font-display text-bay-700">
              {citywideScore.grade}
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate2-700">{citywideScore.headline}</p>
              <p className="mt-2 text-xs text-slate2-500">
                {citywideScore.rows.map((r) => (
                  <span key={r.category} className="inline-block mr-3 tabular-nums">
                    <strong className="text-slate2-700">{r.category.toLowerCase()}</strong>: {r.localPer100k}/100k vs FBI {r.nationalPer100k}/100k ({r.deltaPct > 0 ? "+" : ""}{r.deltaPct}%)
                  </span>
                ))}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate2-500">
            Source: <a href={citywideScore.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">{citywideScore.source.label}</a>
            {citywideScore.asOf && <> · newest report {new Date(citywideScore.asOf).toLocaleDateString()}</>}
          </p>
        </section>
      )}

      {/* City-vs-city compare. Default-collapsed: shows the base score
          only until the user picks another city; then both render
          side-by-side. Helpful for users considering a move between
          cities or pulling together a multi-city safety brief. */}
      <CityCompare baseCitySlug={slug} baseCityLabel={city.label} />

      <section>
        <h2 className="font-display text-xl text-slate2-900">Neighborhoods</h2>
        {areas.length === 0 ? (
          <p className="mt-3 text-sm text-slate2-500">
            No neighborhoods are tracked for {city.label} yet — the adapter is in bootstrap.
            Check back as the data feed is wired up.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {areas.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/cities/${slug}/${a.slug}`}
                  className="surface block px-3 py-2 hover:bg-bay-50 transition-colors"
                >
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-muted p-4 text-sm text-slate2-700 space-y-2">
        <h2 className="font-display text-base text-slate2-900">Jump into the live app</h2>
        <p>
          <Link href="/threats" className="text-bay-700 hover:underline">Awareness</Link> ·{" "}
          <Link href="/map" className="text-bay-700 hover:underline">Crime Map</Link> ·{" "}
          <Link href="/safety-score" className="text-bay-700 hover:underline">Safety Index</Link> ·{" "}
          <Link href="/trends" className="text-bay-700 hover:underline">Trend Feed</Link> ·{" "}
          <Link href="/watch" className="text-bay-700 hover:underline">Neighborhood Watch</Link>
        </p>
      </section>

      {/* Full Fair Housing / lending / insurance / hiring disclaimer.
          This is an indexed SEO page so the legal language must be
          present in the rendered HTML, not just on the in-app routes. */}
      <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">How to read this:</strong>{" "}
        CommunitySafe summarizes publicly published police reports. Scores reflect
        historical reporting only — not predictions of future risk, and not a
        substitute for professional safety advice. Should not be used as the sole
        basis for housing, lending, insurance, or hiring decisions — verify each
        statistic with the cited official source before acting on it. See{" "}
        <Link href="/methodology" className="text-bay-700 hover:underline">/methodology</Link>{" "}
        for how the index is computed.
      </p>
    </main>
  );
}
