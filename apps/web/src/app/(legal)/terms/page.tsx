import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "TravelSafe terms of use — what the app is, what it isn't, and how to use it responsibly.",
};

const LAST_UPDATED = "2026-05-22";

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Legal</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Terms of use</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What TravelSafe is</h2>
        <p>TravelSafe is a neighborhood-level safety-awareness tool that surfaces publicly published police-incident data for 29 supported US cities, compared to the FBI Crime in the Nation national average. It is informational and educational.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What TravelSafe is NOT</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Not a substitute for 911 or any emergency service.</strong> In an emergency, call 911. TravelSafe does not contact emergency services on your behalf.</li>
          <li>Not a substitute for professional safety, legal, medical, or financial advice.</li>
          <li>Not predictive of future crime. All scores reflect historical reporting only — what has already been published in the city&apos;s own open-data feed.</li>
          <li>Not a surveillance product. Individual people are never identified, tracked, or geolocated.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Permitted uses</h2>
        <p>Personal use to inform travel or routine planning, awareness of recent activity in your area, and orientation when moving between cities.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Prohibited uses</h2>
        <p>You agree not to use TravelSafe — or any data exported from it — as the sole or primary basis for:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Housing decisions (renting to, leasing to, denying housing to a person).</li>
          <li>Lending or insurance underwriting decisions.</li>
          <li>Hiring or employment decisions.</li>
          <li>Any decision regulated by the Fair Housing Act, Equal Credit Opportunity Act, or similar laws that prohibit discrimination based on protected characteristics or geographic proxies for them.</li>
          <li>Confronting, following, filming, or approaching any individual.</li>
          <li>Vigilante action of any kind.</li>
        </ul>
        <p>You also agree not to scrape the app to re-host its scoring, attempt to identify individuals from aggregated data, or use the app in any way that violates the terms of the underlying open-data feeds (each city&apos;s open-data portal has its own terms — typically permissive for non-commercial use with attribution).</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Community posts</h2>
        <p>Posts you submit through the CommunitySafe tab are public by design and persist after you close the app. The pre-vetter automatically blocks profanity, slurs, threats of violence, addresses below the block level, vehicle plates, and named individuals. Posts that survive vetting may still be reported and reviewed. You agree your posts are factual to the best of your knowledge and you have the right to share them.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Data accuracy</h2>
        <p>TravelSafe re-displays data from official city open-data portals without editorial modification. We rely on those publishers to be accurate and current. Police-incident data is reported by officers; it reflects what was reported, not necessarily what occurred. Publication delays can be 7-30 days depending on the city. The FBI national-rate comparison uses the most recent annual release (Crime in the Nation 2024); the FBI publishes new rates each October.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">No warranty</h2>
        <p>TravelSafe is provided &quot;as is&quot; without warranty of any kind. We do not warrant that the data is current, complete, or fit for any particular purpose. To the extent permitted by applicable law, TravelSafe and its operators disclaim liability for any decision made in reliance on data displayed by the app.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Changes</h2>
        <p>These terms may be updated as the app evolves. Material changes will be noted by the &quot;Last updated&quot; date at the top of this page.</p>
      </section>

      <p className="text-xs text-slate2-500">
        See also: <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link>.
      </p>
    </main>
  );
}
