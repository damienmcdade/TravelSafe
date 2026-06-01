import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "CommunitySafe terms of use — what the app is, what it isn't, acceptable use, AI assistant disclaimer, and how community posts are moderated.",
};

const LAST_UPDATED = "2026-05-30";

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Legal</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Terms of use</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What CommunitySafe is</h2>
        <p>CommunitySafe is a neighborhood-level safety-awareness tool that surfaces publicly published police-incident data for 38 supported US cities, compared to the FBI Crime in the Nation national average. It is informational and educational.</p>
        <p>
          CommunitySafe is operated by{" "}
          <a href="https://cyberwaveglobal.com" target="_blank" rel="noopener noreferrer" className="text-bay-700 hover:underline">CyberWave Technologies LLC</a>{" "}
          (cyberwaveglobal.com) (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By using CommunitySafe you
          agree to these Terms. Questions about these Terms:{" "}
          <a href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20terms" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a>.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What CommunitySafe is NOT</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Not a substitute for 911 or any emergency service.</strong> In an emergency, call 911. CommunitySafe does not contact emergency services on your behalf.</li>
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
        <p>You agree not to use CommunitySafe — or any data exported from it — as the sole or primary basis for:</p>
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
        <h2 className="font-display text-xl text-slate2-900">Acceptable use &amp; rate limits</h2>
        <p>To keep the app responsive for everyone and to protect the upstream open-data feeds from being saturated, public API endpoints are rate-limited per IP — typical limits are 30-60 requests per minute per endpoint family, with the AI Assistant capped lower (10/min) because each call has a real per-token cost. Sustained automated access beyond these limits will receive HTTP 429 responses with a <code className="text-xs">Retry-After</code> header.</p>
        <p>You agree not to attempt to circumvent the rate limits, generate synthetic load against the app, scrape the per-neighborhood pages at high volume, or otherwise impair the service&apos;s availability for other users.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">AI Assistant</h2>
        <p>The optional AI Assistant uses a third-party large language model to answer questions about CommunitySafe&apos;s data. By using it you acknowledge that:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Outputs are generated by a probabilistic model and may be inaccurate, incomplete, or out of date. Every numeric claim the assistant makes includes a source URL — verify against that source before acting on it.</li>
          <li>Outputs are not professional advice (legal, medical, security, or otherwise) and must not be treated as such.</li>
          <li>The text of your prompt is transmitted to the AI provider for processing. See the <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link> policy for what travels and how.</li>
          <li>The assistant is not available in regions where it would violate local law.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Community posts &amp; moderation</h2>
        <p>Posts you submit through the CommunitySafe tab are public by design and persist after you close the app. An automated pre-vetter blocks posts containing profanity or slurs, threats of violence, addresses below the block level, vehicle plates, phone numbers, named individuals, or descriptions that profile people by appearance. Posts that survive vetting may still be reported by other users and reviewed.</p>
        <p>Repeated rejected posts, repeated upheld reports against you, or any abuse of the moderation system itself can result in a temporary suspension or, for severe / repeated violations, a permanent ban from posting. You agree your posts are factual to the best of your knowledge and that you have the right to share them. Edits to your own posts are recorded in an append-only history so the moderation context is preserved.</p>
        <p>By submitting a post, comment, or photo you grant CyberWave Technologies LLC a worldwide, non-exclusive, royalty-free license to host, store, reproduce, display, and distribute that content within and in connection with the Service. You retain ownership of your content. This license ends when you delete the content or your account, except for copies retained in backups or already shared by others.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Data accuracy</h2>
        <p>CommunitySafe re-displays data from official city open-data portals without editorial modification. We rely on those publishers to be accurate and current. Police-incident data is reported by officers; it reflects what was reported, not necessarily what occurred. Publication delays can be 7-30 days depending on the city. The FBI national-rate comparison comes from the FBI Crime Data Explorer (cde.ucr.cjis.gov), pulled as the annual sum of monthly UCR rates for the most-recent complete calendar year. For full methodology, see the <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link> page.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">No warranty</h2>
        <p>CommunitySafe is provided &quot;as is&quot; without warranty of any kind. We do not warrant that the data is current, complete, or fit for any particular purpose. To the extent permitted by applicable law, CommunitySafe and its operators disclaim liability for any decision made in reliance on data displayed by the app.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Limitation of liability &amp; indemnity</h2>
        <p>To the maximum extent permitted by applicable law, CyberWave Technologies LLC and its operators, officers, and contributors will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss arising from your use of — or inability to use — CommunitySafe or any decision made in reliance on it. CommunitySafe is provided free of charge; to the extent any liability cannot be excluded, it is limited in the aggregate to USD $100.</p>
        <p>You agree to indemnify and hold harmless CyberWave Technologies LLC from any claim arising out of your misuse of the app, your violation of these Terms, your use of the data for a prohibited purpose (including any housing, lending, insurance, or employment decision), or any content you submit to the community feed.</p>
        <p>If any provision of these Terms is held unenforceable, the remaining provisions stay in effect. These Terms, together with the <Link href="/privacy" className="text-bay-700 hover:underline">Privacy Policy</Link>, are the entire agreement between you and CyberWave Technologies LLC regarding CommunitySafe.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Governing law &amp; contact</h2>
        <p>CommunitySafe is operated by CyberWave Technologies LLC, a California limited liability company. These Terms are governed by the laws of the State of California, without regard to its conflict-of-laws rules, and you agree to the exclusive jurisdiction and venue of the state and federal courts located in California for any dispute that is not otherwise resolved. Questions about these Terms: <a href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20terms" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a> · <a href="https://cyberwaveglobal.com" target="_blank" rel="noopener noreferrer" className="text-bay-700 hover:underline">cyberwaveglobal.com</a>.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Changes</h2>
        <p>These terms may be updated as the app evolves. Material changes will be noted by the &quot;Last updated&quot; date at the top of this page.</p>
      </section>

      <LegalFooter />
    </main>
  );
}
