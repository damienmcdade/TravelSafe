import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Who builds CommunitySafe, what it is and isn't, how it's funded, and how to reach the operator.",
};

const LAST_UPDATED = "2026-05-27";

export default function AboutPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">About</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">About CommunitySafe</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What CommunitySafe is</h2>
        <p>
          CommunitySafe is an independent neighborhood-safety information site for 37
          US cities. It takes police-department open-data feeds and FBI Uniform
          Crime Reporting figures &mdash; both already public &mdash; and turns
          them into a single 0&ndash;100 Safety Index per neighborhood, plus
          straightforward views of what kinds of incidents are reported and
          when. See the{" "}
          <Link href="/methodology" className="text-bay-700 underline">
            Methodology
          </Link>{" "}
          page for the exact math, sources, and limitations.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What CommunitySafe is not</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Not an emergency service. Call 911 for an emergency.</li>
          <li>
            Not a surveillance product. We never track or identify individuals.
            See <Link href="/privacy" className="text-bay-700 underline">Privacy</Link>.
          </li>
          <li>
            Not a substitute for due diligence on a specific address &mdash; the
            data is neighborhood-aggregated and lagged by the publishing cadence
            of each city.
          </li>
          <li>
            Not a demographic or profiling tool. Demographic categories
            (race, ethnicity, religion, age, gender, sexual orientation) are not
            stored, displayed, or analyzed anywhere.
          </li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Who builds it</h2>
        <p>
          CommunitySafe is independently operated. The codebase, methodology, and
          adapter list are public on{" "}
          <a
            href="https://github.com/damienmcdade/TravelSafe"
            target="_blank"
            rel="noopener noreferrer"
            className="text-bay-700 underline"
          >
            GitHub
          </a>
          . The site is not affiliated with any police department, municipal
          government, or law-enforcement vendor &mdash; all data is sourced from
          each city&rsquo;s own open-data portal, cited inline on every page.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed" id="founder">
        <h2 className="font-display text-xl text-slate2-900">Founder</h2>
        <p>
          CommunitySafe&rsquo;s founder is a{" "}
          <strong>U.S. Army Veteran</strong>. The product was shaped around
          what actually keeps people safer at the neighborhood level: honest
          open data, moderated community input, and personal-safety tools
          that respect the user&rsquo;s autonomy &mdash; no surveillance, no
          profiling, no alarmism. The same standard of accuracy and care
          expected of any tool we&rsquo;d trust ourselves.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">How it&rsquo;s funded</h2>
        <p>
          CommunitySafe is free to browse without an account. Optional Personal
          Safety features (Check-In timer, Live Share, Trusted Contacts) also
          carry no fee. Operating costs (cloud hosting, AI provider, push
          delivery) are covered by the operator. If contextual advertising is
          ever enabled it will be disclosed on this page and a cookie banner
          will appear before the first ad loads.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed" id="contact">
        <h2 className="font-display text-xl text-slate2-900">Contact</h2>
        <p>
          Bug reports, data-source corrections, takedown requests, privacy
          requests, press inquiries:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Email:{" "}
            <a
              href="mailto:info@cyberwaveglobal.com?subject=CommunitySafe%20inquiry"
              className="text-bay-700 underline"
            >
              info@cyberwaveglobal.com
            </a>
          </li>
          <li>
            GitHub issues (bug reports, code-level questions):{" "}
            <a
              href="https://github.com/damienmcdade/TravelSafe/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-bay-700 underline"
            >
              github.com/damienmcdade/TravelSafe/issues
            </a>
          </li>
        </ul>
        <p className="text-xs text-slate2-500">
          For privacy-rights requests under GDPR, CCPA/CPRA, or any
          equivalent law, use the same email. Per{" "}
          <Link href="/privacy" className="text-bay-700 underline">
            Privacy
          </Link>
          , we respond within 30 days.
        </p>
      </section>
    </main>
  );
}
