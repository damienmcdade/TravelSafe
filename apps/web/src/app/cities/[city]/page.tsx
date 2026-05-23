import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CITIES, cityBySlug } from "@/server/services/crime-data/cities";
import { getCitywideSafetyScore } from "@/server/services/watch/safety-score";

interface Props {
  params: Promise<{ city: string }>;
}

// Pre-render every supported city. Phoenix is included even though its
// adapter is in bootstrap — the page degrades gracefully via the
// soft-fail in getCitywideSafetyScore.
export function generateStaticParams() {
  return CITIES.map((c) => ({ city: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const city = cityBySlug(slug);
  if (!city) return { title: "City not found" };
  return {
    title: `${city.label} safety overview`,
    description: `Neighborhood-level safety data for ${city.label} — official police-feed coverage compared to the FBI Crime in the Nation 2024 national average.`,
    alternates: { canonical: `/cities/${slug}` },
    openGraph: {
      title: `${city.label} safety overview · TravelSafe`,
      description: `Browse every supported ${city.label} neighborhood with a current Safety Index and recent reports timeline. Data sourced directly from the city's official police open-data feed.`,
      type: "article",
    },
  };
}

// 1-hour ISR — city coverage changes when a city is added/removed
// from the registry, which we do via deploys, so hourly revalidation
// is plenty.
export const revalidate = 3600;

export default async function CityLandingPage({ params }: Props) {
  const { city: slug } = await params;
  const city = cityBySlug(slug);
  if (!city) notFound();

  const [areas, citywideScore] = await Promise.all([
    city.discover().catch(() => []),
    getCitywideSafetyScore(slug).catch(() => null),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
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

      <p className="text-xs text-slate2-500 leading-snug">
        TravelSafe summarizes publicly published police reports. Scores reflect historical reporting,
        not predictions of future risk. See{" "}
        <Link href="/methodology" className="text-bay-700 hover:underline">/methodology</Link>{" "}
        for how the index is computed.
      </p>
    </main>
  );
}
