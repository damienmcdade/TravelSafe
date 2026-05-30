import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Pricing",
  description: "CommunitySafe is free to use. Pro tier coming soon for advanced safety features.",
};

/// Public /pricing page. Scaffold only — no payment integration. The
/// tier comparison reflects the current set of features that COULD be
/// gated; final pricing + actual gate enforcement are deferred pending
/// product decisions. This page exists so:
///   1. Search engines + curious users see CommunitySafe has a clear
///      free-to-use posture.
///   2. The infrastructure is in place to flip features into Pro
///      without scrambling for a pricing page when revenue lands.
///   3. The "no fear-monetization" guarantee is explicit on the
///      page itself.
export default function PricingPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      <header className="text-center space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Pricing</p>
        <h1 className="font-display text-4xl sm:text-5xl text-slate2-900">
          Free to use, today and for the foreseeable future
        </h1>
        <p className="text-slate2-700 max-w-2xl mx-auto">
          CommunitySafe&apos;s core mission is calm, accurate neighborhood safety awareness for travelers
          and residents — that core stays free. A Pro tier may arrive later for power-user
          conveniences, but it will <em>never</em> gate the safety information itself.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PricingCard
          name="Free"
          price="$0"
          tagline="Everything you need to make safer travel decisions."
          highlight={false}
          features={[
            "City & neighborhood Safety Scores across 30 US cities",
            "Live crime feeds + analytical baselines",
            "Crime Map, Safe Route, Trend Feed",
            "Community posts (CommunitySafe)",
            "Daily digest notifications",
            "Saved areas + dark mode",
            "Privacy controls + data export",
          ]}
          cta={{ label: "Start using CommunitySafe", href: "/now" }}
        />
        <PricingCard
          name="Pro"
          price="Coming soon"
          tagline="Power-user features for frequent travelers and safety-conscious teams."
          highlight
          features={[
            "Multi-city saved areas with cross-city dashboards",
            "Real-time push notifications (Free is daily digest)",
            "Unlimited AI incident summaries",
            "Travel itinerary safety reports (export to PDF)",
            "Custom alert geo-fences",
            "Priority access to new city adapters",
          ]}
          cta={{ label: "Join the waitlist", href: "mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20Pro%20waitlist" }}
        />
      </section>

      <section className="surface p-6 sm:p-8 space-y-3">
        <h2 className="font-display text-2xl text-slate2-900">What we promise (and don&apos;t)</h2>
        <ul className="text-sm text-slate2-700 space-y-2 list-disc pl-5">
          <li>The Safety Score, Crime Map, Trend Feed, and core neighborhood data <strong>stay free</strong>. We will never put basic safety information behind a paywall.</li>
          <li>We will <strong>never monetize fear</strong>: no urgency tactics, no scarcity copy, no &ldquo;upgrade or be unsafe&rdquo; framing.</li>
          <li>We will <strong>never sell your data</strong>. CommunitySafe doesn&apos;t collect demographic data and doesn&apos;t track individuals. Pricing tiers will gate convenience features, never user data.</li>
          <li>Pro features will be additions, not subtractions — nothing the Free tier offers today gets removed when Pro ships.</li>
        </ul>
      </section>

      <LegalFooter />
    </main>
  );
}

function PricingCard({
  name, price, tagline, features, highlight, cta,
}: {
  name: string;
  price: string;
  tagline: string;
  features: string[];
  highlight: boolean;
  cta: { label: string; href: string };
}) {
  return (
    <article className={`surface p-6 sm:p-8 flex flex-col ${highlight ? "ring-2 ring-bay-400" : ""}`}>
      <header>
        <p className="text-xs uppercase tracking-wider text-bay-700 font-medium">{name}</p>
        <p className="mt-1 font-display text-3xl text-slate2-900">{price}</p>
        <p className="mt-2 text-sm text-slate2-700">{tagline}</p>
      </header>
      <ul className="mt-5 space-y-2 text-sm text-slate2-700 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-baseline gap-2">
            <span className="text-sage-700 shrink-0" aria-hidden>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={cta.href}
        className={`mt-6 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          highlight
            ? "bg-bay-500 text-white hover:bg-bay-600"
            : "surface-muted text-slate2-900 hover:bg-bay-100"
        }`}
      >
        {cta.label}
      </a>
    </article>
  );
}
