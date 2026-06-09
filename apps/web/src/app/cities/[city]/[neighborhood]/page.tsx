import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cityBySlug } from "@/server/services/crime-data/cities";
import { getSafetyScore } from "@/server/services/watch/safety-score";
import { getTrendForArea } from "@/server/services/watch/trend-feed";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";
import { formatReportDate } from "@/lib/format";
import { LegalFooter } from "@/components/LegalFooter";

interface Props {
  params: Promise<{ city: string; neighborhood: string }>;
}

// We do NOT generateStaticParams across every (city, neighborhood)
// combination at build time — 30 cities × ~50 areas is ~1,500 pages
// and the discover() pulls would substantially slow the build. The
// pages are dynamic (revalidate=3600) and each one is edge-cached
// after first render. Crawlers + share-targets hit the cached HTML;
// only the very first visit to an unseen URL pays the SSR cost.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug, neighborhood: areaSlug } = await params;
  const city = cityBySlug(citySlug);
  if (!city) return { title: "Not found" };
  const areas = await city.discover().catch(() => []);
  const area = areas.find((a) => a.slug === areaSlug);
  if (!area) return { title: "Not found" };
  return {
    title: `${area.label}, ${city.label} safety overview`,
    description: `Recent police-feed safety data for ${area.label} in ${city.label}, compared to the ${FBI_DATA_LABEL} national average. Updated hourly.`,
    alternates: { canonical: `/cities/${citySlug}/${areaSlug}` },
    openGraph: {
      title: `${area.label}, ${city.label} · Safety overview · CommunitySafe`,
      description: `${area.label}'s Safety Index, recent reports, and FBI national comparison — sourced from the official ${city.label} police open-data feed.`,
      type: "article",
    },
  };
}

// WCAG-AA contrast checked: each `text-*` foreground hits ≥4.5:1 against
// its paired `bg-*`. Previously E used coral-700 on amber2-100 which
// computed to ~1.3:1; switched to coral-50 background so the foreground
// reads cleanly. Ring colors are decorative.
const GRADE_TONE: Record<string, string> = {
  A: "text-sage-700 bg-sage-100 ring-sage-300",
  B: "text-sage-700 bg-sage-50 ring-sage-200",
  C: "text-slate2-700 bg-sand-50 ring-sand-300",
  D: "text-amber2-700 bg-amber2-50 ring-amber2-300",
  E: "text-coral-700 bg-coral-50 ring-coral-400",
  "N/A": "text-slate2-500 bg-slate2-50 ring-slate2-200",
};

export default async function NeighborhoodLandingPage({ params }: Props) {
  const { city: citySlug, neighborhood: areaSlug } = await params;
  const city = cityBySlug(citySlug);
  if (!city) notFound();

  const areas = await city.discover().catch(() => []);
  const area = areas.find((a) => a.slug === areaSlug);
  if (!area) notFound();

  // Fetch score + trend in parallel. Both have soft-fail in their
  // implementations; a feed outage degrades the page rather than
  // 500-ing the SSR.
  const [score, trend] = await Promise.all([
    getSafetyScore(areaSlug, area.label).catch(() => null),
    getTrendForArea(areaSlug, area.label).catch(() => null),
  ]);

  // JSON-LD structured data: Place + BreadcrumbList. Gives Google
  // enough signal to surface rich snippets (breadcrumb chips, place
  // description) for shared neighborhood links. Inlined in SSR HTML so
  // crawlers see it on first paint.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://communitysafe.app";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Place",
        name: `${area.label}, ${city.label}`,
        url: `${base}/cities/${citySlug}/${areaSlug}`,
        description: `Recent police-feed safety data for ${area.label} in ${city.label}, compared to the FBI Crime Data Explorer ${score?.source.publishedYear ?? 2023} national average.`,
        containedInPlace: {
          "@type": "Place",
          name: city.label,
          url: `${base}/cities/${citySlug}`,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Cities", item: `${base}/cities` },
          { "@type": "ListItem", position: 2, name: city.label, item: `${base}/cities/${citySlug}` },
          { "@type": "ListItem", position: 3, name: area.label, item: `${base}/cities/${citySlug}/${areaSlug}` },
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
        <Link href={`/cities/${citySlug}`} className="text-bay-700 hover:underline">{city.label}</Link>
        {" / "}
        <span>{area.label}</span>
      </nav>

      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Neighborhood overview</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">{area.label}, {city.label}</h1>
        <p className="mt-2 text-sm text-slate2-700 max-w-2xl">
          Recent police-feed safety data for {area.label} in {city.label}, compared to the{" "}
          {FBI_DATA_LABEL} national average. Sourced directly from the {city.label} police open-data feed.
        </p>
      </header>

      {score && (
        <section className={`surface p-5 sm:p-6 ring-1 ${(GRADE_TONE[score.grade] ?? "").split(" ").slice(2).join(" ")} ${(GRADE_TONE[score.grade] ?? "").split(" ")[1] ?? ""}`}>
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-20 h-20 rounded-2xl ring-2 bg-white text-4xl font-display ${(GRADE_TONE[score.grade] ?? "").split(" ")[0] ?? "text-slate2-700"} ${(GRADE_TONE[score.grade] ?? "").split(" ").slice(2).join(" ")}`}>
              {score.grade}
            </div>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wider font-medium text-slate2-500">Safety Index</p>
              <h2 className="mt-0.5 font-display text-xl text-slate2-900">{score.headline}</h2>
            </div>
          </div>
          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {score.rows.map((r) => (
              <li key={r.category} className="surface-muted p-3">
                <p className="text-xs uppercase tracking-wider text-slate2-500">{r.category === "PERSONS" ? "Violent (persons)" : "Property"}</p>
                <p className="mt-1 text-slate2-900 tabular-nums">
                  <strong>{r.localPer100k.toLocaleString()}</strong> / 100k local
                </p>
                {/* Primary comparison: vs city. The grade itself was
                    computed against the city baseline, so the headline
                    delta should match. National stays as a secondary
                    reference below. */}
                <p className="text-xs text-slate2-500 tabular-nums">
                  vs {city.label} {r.cityPer100k.toLocaleString()} / 100k citywide ({r.cityDeltaPct > 0 ? "+" : ""}{r.cityDeltaPct}%)
                </p>
                <p className="text-[11px] text-slate2-500 tabular-nums mt-0.5 opacity-80">
                  reference: FBI {r.nationalPer100k.toLocaleString()} / 100k national ({r.deltaPct > 0 ? "+" : ""}{r.deltaPct}%)
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate2-500">
            ~{score.populationEstimate.toLocaleString()} residents (estimated, US Census Vintage 2023-2024) ·{" "}
            window ~{score.windowDays} days ·{" "}
            {score.asOf && <>newest report {formatReportDate(score.asOf)} · </>}
            <a href={score.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">{score.source.label}</a>
          </p>
          {/* CFS calibration badge — only renders for Cleveland, NOLA,
              Las Vegas where dataSourceType === "cfs". The score's
              already been scaled; the badge keeps the methodology
              transparent on the SEO page just like in the app. */}
          {score.dataSourceType === "cfs" && (
            <p className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bay-50 border border-bay-200 text-bay-700 text-[11px] uppercase tracking-wider font-medium">
              CFS-calibrated × {(score.cfsScale ?? 1).toFixed(2)}
            </p>
          )}
          {score.dataConfidence && score.dataConfidence !== "high" && score.dataConfidenceNote && (
            <p
              role="status"
              className={`mt-3 text-xs px-3 py-2 rounded-lg border leading-snug ${
                score.dataConfidence === "low"
                  ? "bg-amber2-50 border-amber2-300/60 text-amber2-700"
                  : "bg-sand-50 border-sand-300 text-slate2-700"
              }`}
            >
              <strong className="text-slate2-900">
                {score.dataConfidence === "low" ? "Limited data — grade is provisional." : "Smaller-than-usual data window."}
              </strong>{" "}
              {score.dataConfidenceNote}
            </p>
          )}
        </section>
      )}

      {trend && trend.totalIncidents > 0 && (
        <section className="surface p-5">
          <h2 className="font-display text-lg text-slate2-900">Recent activity ({trend.totalIncidents.toLocaleString()} reports in the last 30 days)</h2>
          {trend.timeOfDay && trend.timeOfDay.dominantPct >= 30 && (
            <p className="mt-2 text-sm text-slate2-700">
              Most reports cluster in <strong>{periodLabel(trend.timeOfDay.dominantPeriod)}</strong> ({trend.timeOfDay.dominantPct}% of the window).
            </p>
          )}
          <ul className="mt-3 space-y-1.5 text-sm text-slate2-700">
            {trend.bullets.filter((b) => b.kind === "trend").slice(0, 5).map((b, i) => (
              <li key={i}>· {b.text}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface-muted p-5 text-sm text-slate2-700 space-y-2">
        <h2 className="font-display text-base text-slate2-900">Explore {area.label} in the live app</h2>
        <p>
          <Link href="/city" className="text-bay-700 hover:underline">City Awareness</Link> ·{" "}
          <Link href="/map" className="text-bay-700 hover:underline">Crime Map</Link> ·{" "}
          <Link href="/watch" className="text-bay-700 hover:underline">Neighborhood Watch</Link>
        </p>
      </section>

      <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">How to read this:</strong>{" "}
        CommunitySafe summarizes publicly published police reports. Scores reflect historical reporting only — not
        predictions of future risk, and not a substitute for professional safety advice. These scores should not be used as the sole
        basis for housing, lending, insurance, or hiring decisions. See{" "}
        <Link href="/methodology" className="text-bay-700 hover:underline">/methodology</Link>{" "}
        for the full calculation.
      </p>

      <LegalFooter />
    </main>
  );
}

function periodLabel(p: "late_night" | "morning" | "afternoon" | "evening"): string {
  return p === "late_night" ? "late night (12am–6am)"
       : p === "morning"    ? "morning (6am–12pm)"
       : p === "afternoon"  ? "afternoon (12pm–6pm)"
       :                      "evening (6pm–12am)";
}
