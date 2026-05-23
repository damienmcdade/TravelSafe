"use client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { TrendPanel } from "@/components/TrendPanel";

/// SEO/bookmark alias for the Trends section that lives canonically on
/// /safety-score (now both Score + Trend live on one Investigate page).
/// Renders the same TrendPanel component so the experience is identical
/// from either entry point. URL kept alive so existing bookmarks and
/// external links don't 404.
export default function TrendsAliasPage() {
  const { city } = useCity();
  const { area } = useArea(city.slug);
  useDocumentTitle(`Trend Feed · ${area?.label ?? city.label}`);

  return (
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">SafeZone · Trend Feed · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          What&apos;s shifted in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{city.label} recently</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          This page is part of the SafeZone Investigate workflow. For the full picture (Score + Trends in one place),
          visit <a href="/safety-score" className="text-bay-700 hover:underline">SafeZone Safety Index</a>.
        </p>
      </header>
      <TrendPanel />
    </main>
  );
}
