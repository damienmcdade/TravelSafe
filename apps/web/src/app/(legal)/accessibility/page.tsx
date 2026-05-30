import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "CommunitySafe's accessibility commitment — our target conformance (WCAG 2.1 AA), the measures we take, known limitations, and how to report an accessibility barrier.",
};

const LAST_UPDATED = "2026-05-30";

export default function AccessibilityPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Legal</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Accessibility</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Our commitment</h2>
        <p>CyberWave Technologies LLC, the operator of CommunitySafe, is committed to making this site usable by the widest possible audience, including people who rely on assistive technology. We treat accessibility as part of the product, not an afterthought.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Conformance target</h2>
        <p>We aim to conform to the <strong>Web Content Accessibility Guidelines (WCAG) 2.1, Level AA</strong>. WCAG defines requirements for making web content more accessible to people with visual, auditory, motor, and cognitive disabilities. CommunitySafe is partially conformant: most of the app meets the standard, and we treat any gap as a bug to fix.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Measures we take</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Semantic HTML with landmark regions and a &ldquo;Skip to main content&rdquo; link on every page.</li>
          <li>Keyboard-operable navigation, controls, and the city / neighborhood pickers, with visible focus states.</li>
          <li>Text colour and interactive elements designed to meet AA contrast ratios; a dark-mode option in Settings.</li>
          <li>Labelled form fields, buttons, and ARIA roles on interactive widgets (e.g. disclaimers use <code className="text-xs">role=&quot;note&quot;</code>).</li>
          <li>Alt text on imagery and descriptive link text rather than &ldquo;click here&rdquo;.</li>
          <li>Responsive layout that supports zoom and reflow without loss of content.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Known limitations</h2>
        <p>Some content is outside our full control or still being improved:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>The interactive crime map relies on a third-party mapping library; map-specific gestures may be harder to operate with a keyboard alone. The same data is available in the non-map list and table views.</li>
          <li>Third-party advertising slots are rendered by Google AdSense and are not fully under our control.</li>
          <li>City backdrop photos are sourced from Wikimedia Commons with the contributor&rsquo;s original captions.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Report a barrier</h2>
        <p>If you encounter an accessibility barrier, or need information on this site in a different format, contact us and we will work with you to provide it. We aim to respond within five business days.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Email: <a href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20accessibility" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a></li>
          <li>Operator: CyberWave Technologies LLC · <a href="https://cyberwaveglobal.com" target="_blank" rel="noopener noreferrer" className="text-bay-700 hover:underline">cyberwaveglobal.com</a></li>
        </ul>
        <p className="text-xs text-slate2-500">See also our <Link href="/privacy" className="text-bay-700 hover:underline">Privacy Policy</Link> and <Link href="/terms" className="text-bay-700 hover:underline">Terms of Use</Link>.</p>
      </section>

      <LegalFooter />
    </main>
  );
}
