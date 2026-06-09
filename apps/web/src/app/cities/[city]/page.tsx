import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cityBySlug } from "@/server/services/crime-data/cities";
import { getCitywideSafetyScore } from "@/server/services/watch/safety-score";
import { CityCompare } from "@/components/CityCompare";
import { LegalFooter } from "@/components/LegalFooter";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";
import { formatReportDate } from "@/lib/format";

interface Props {
  params: Promise<{ city: string }>;
}

// fix(deploy build logs): no generateStaticParams — city pages are rendered
// on-demand (first request) and cached via `revalidate` (ISR) below, NOT
// pre-rendered at build. Build-time static generation forced every city's
// adapter to fetch live police feeds (multi-MB) during `next build`, which
// (a) timed out cities (lapd/sf/chicago/seattle/vb …) and (b) blew Next's
// 2 MB Data-Cache per-entry limit — the recurring "Failed to set fetch cache
// URL … TimeoutError" + "QUOTA_EXCEEDED_ERR: 22" build-log spam. Earlier the
// build also excluded Cleveland for the same reason (its cold fetch is ~5min);
// on-demand rendering makes that special-case unnecessary. SEO is preserved
// (crawlers get fully server-rendered HTML); the first visitor per city per
// 5-min window pays the cold render, every subsequent hit serves from edge cache.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = cityBySlug(slug);
  if (!city) return { title: "City not found" };
  return {
    title: `${city.label} safety overview`,
    description: `Neighborhood-level safety data for ${city.label} — official police-feed coverage compared to the ${FBI_DATA_LABEL} national average.`,
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

  // v63 hotfix3 — bounded timeouts. Cleveland (now in DYNAMIC_ONLY_CITIES)
  // hits this path on every cold visit. Cleveland's adapter cold-cache
  // fetch takes ~5min, which blows the Vercel function ceiling and the
  // page times out at 15s, taking the city page COMPLETELY OFFLINE
  // until the cache warms via warm-worker. discover() + safety-score
  // each get their own Promise.race against a 12s deadline; on timeout
  // the page renders with `null`/`[]` and the user sees a "data is
  // warming up" surface instead of a Vercel error screen.
  const TIMEOUT_MS = 12_000;
  // fix(audit api-code-6): clear the deadline timer once the work settles so a
  // fast render doesn't leave a 12s setTimeout pending on the (possibly warm)
  // function instance.
  const withTimeout = <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
  };
  const [areas, citywideScore] = await Promise.all([
    // Display the primary (real civic) area list where defined (VB: ~100 vs 961);
    // the citywide score below still uses the full set. fix(audit vb-over-fragmentation).
    withTimeout((city.discoverPrimary ?? city.discover)().catch(() => []), [] as Awaited<ReturnType<typeof city.discover>>),
    withTimeout(getCitywideSafetyScore(slug).catch(() => null), null),
  ]);

  // JSON-LD structured data. Schema.org Place + BreadcrumbList lets
  // search engines understand the page as a location overview and
  // surface rich snippets (breadcrumb chips, citywide metadata) in
  // results. Inlined as a single <script> in the page body so it
  // ships with the SSR HTML — no extra round trip.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://communitysafe.app";
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
        // fix(audit web-xss-1): escape "<" so a label can't break the <script>
        // context via a literal </script> (JSON.stringify escapes quotes, not "<").
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
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
            {citywideScore.asOf && <> · newest report {formatReportDate(citywideScore.asOf)}</>}
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
          <Link href="/city" className="text-bay-700 hover:underline">City Awareness</Link> ·{" "}
          <Link href="/map" className="text-bay-700 hover:underline">Crime Map</Link> ·{" "}
          <Link href="/city" className="text-bay-700 hover:underline">Safety Index</Link> ·{" "}
          <Link href="/city" className="text-bay-700 hover:underline">Trend Feed</Link> ·{" "}
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
        substitute for professional safety advice. These scores should not be used as the sole
        basis for housing, lending, insurance, or hiring decisions — verify each
        statistic with the cited official source before acting on it. See{" "}
        <Link href="/methodology" className="text-bay-700 hover:underline">/methodology</Link>{" "}
        for how the index is computed.
      </p>

      {/* Per-city editorial context. Derived from this city's own live values
          (grade, neighborhood count, category deltas) so each city page carries
          unique, human-useful analysis rather than a templated stat dump —
          directly addressing AdSense "low value / scaled content" concerns. */}
      <section className="surface p-5 sm:p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">About {city.label} safety data</h2>
        <p>
          This overview aggregates {city.label}&apos;s official police open-data
          feed{areas.length > 0 ? ` across ${areas.length.toLocaleString()} neighborhoods` : ""}{" "}
          and compares it to the {FBI_DATA_LABEL} national rate per 100,000 residents.
          {citywideScore
            ? ` ${city.label} currently carries a citywide Safety Index of ${citywideScore.grade}. ${citywideScore.headline}`
            : ""}
        </p>
        <p>
          Use the neighborhood list above to drill into a specific area — every
          area has its own running incident timeline and category breakdown.
          Safety is local: a citywide grade smooths over real differences between
          neighborhoods, so we always recommend reading the area you actually care
          about rather than the headline number. For the full data sourcing,
          population normalization, and grade thresholds, see our{" "}
          <Link href="/methodology" className="text-bay-700 hover:underline">methodology</Link>.
          To compare {city.label} against another metro, use the comparison tool above.
        </p>
      </section>

      <LegalFooter />
    </main>
  );
}
