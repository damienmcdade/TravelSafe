import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How TravelSafe computes the Safety Index, where the data comes from, and the limitations of the math.",
};

const LAST_UPDATED = "2026-05-23";

export default function MethodologyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Methodology</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">How the Safety Index works</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
        <p className="mt-3 text-sm text-slate2-700 max-w-2xl">
          TravelSafe translates two public datasets into one easy-to-read 0&ndash;100 number using
          arithmetic, not predictions. This page is the canonical source — if any in-app caption
          conflicts with the description here, the in-app caption is wrong and should be fixed.
        </p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Data sources</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong className="text-slate2-900">City open-data portals.</strong> Each of TravelSafe&apos;s
            30 supported cities publishes police-incident records through an official open-data feed
            (SDPD NIBRS, LAPD Crime Data, SFPD Incident Reports, Chicago CPD, NYPD Complaint Data,
            Seattle SPD, Boston BPD, DC MPD, Philadelphia PPD, Denver, Detroit, Oakland, Cincinnati,
            New Orleans, Baton Rouge, Cambridge, Dallas, Charlotte, Nashville, Minneapolis, Cleveland,
            Milwaukee, Las Vegas, Boise, Buffalo, Tucson, Kansas City, Saint Paul, Pittsburgh, Phoenix).
            We pull the raw records via the same public API the city itself documents.
          </li>
          <li>
            <strong className="text-slate2-900">FBI Crime in the Nation 2024.</strong> The benchmark we
            compare per-100,000 rates against — Violent (Persons): 364, Property: 1,896.
            Source:{" "}
            <a
              href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend"
              target="_blank" rel="noreferrer"
              className="text-bay-700 hover:underline"
            >
              cde.ucr.cjis.gov
            </a>
            . The FBI publishes a new annual release each October; we update the constant on each release.
          </li>
          <li>
            <strong className="text-slate2-900">US Census Vintage 2024 population estimates.</strong> Used
            as the denominator for the per-100,000 rate calculation. Source:{" "}
            <a
              href="https://www.census.gov/programs-surveys/popest.html"
              target="_blank" rel="noreferrer"
              className="text-bay-700 hover:underline"
            >
              census.gov
            </a>
            .
          </li>
        </ol>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">How the Safety Index is computed</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong className="text-slate2-900">Count the recent reports.</strong> We pull every
            police-incident record the city has published in the cached window (typically 30&ndash;180 days
            depending on the adapter). Records are split into the two FBI categories with a published
            national rate: Violent (Persons) and Property. Society / public-order offenses are tracked
            internally but excluded from the score because the FBI doesn&apos;t publish a national rate
            for them.
          </li>
          <li>
            <strong className="text-slate2-900">Estimate per-area population.</strong> For citywide
            scores, the denominator is the city&apos;s actual US Census Vintage 2024 population. For
            per-neighborhood scores, the denominator is approximated two ways:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <em>Polygon-area weighting (preferred):</em> per-area population &asymp; cityPop &times;
                (polygonKm&sup2; / cityTotalKm&sup2;). Uses the city&apos;s official neighborhood polygon
                files. Assumes roughly uniform density across the city &mdash; close enough for relative
                ranking but not census-grade.
              </li>
              <li>
                <em>Peer-share fallback:</em> when polygon data isn&apos;t available, we scale the
                city&apos;s per-100k rate by the area&apos;s share of citywide reports vs. the average
                per-neighborhood share. A neighborhood reporting the average share gets the city&apos;s
                rate; one reporting 2&times; the average share gets 2&times; the rate.
              </li>
            </ul>
          </li>
          <li>
            <strong className="text-slate2-900">Annualize and express as a per-100,000 rate.</strong>{" "}
            (reports &times; 365 &divide; windowDays &divide; population) &times; 100,000. Same
            denominator and unit the FBI uses for its city-vs-national comparisons.
          </li>
          <li>
            <strong className="text-slate2-900">Compare to the nearest official baseline.</strong> The
            per-neighborhood grade compares the area&apos;s rate to its OWN CITY&apos;s rate, not the
            FBI national average. Cities concentrate reportable activity, and neighborhoods concentrate it
            further &mdash; comparing a tightly-bounded urban neighborhood directly to a national average
            (which is itself a blend of rural, suburban, and urban) systematically inflates the
            &ldquo;above national&rdquo; appearance. The city baseline is the nearest official
            comparison we can compute consistently across every supported city. The FBI national rate is
            kept in the response as a secondary reference so users can see where each city sits relative
            to national. For the citywide score itself, the FBI national rate IS the right comparison
            anchor and is used as primary.
          </li>
        </ol>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Calls-for-service calibration</h2>
        <p>
          Three cities &mdash; <strong>Cleveland</strong>, <strong>New Orleans</strong>, and{" "}
          <strong>Las Vegas</strong> &mdash; publish <em>calls-for-service</em> (CFS) feeds
          rather than closed NIBRS incident reports. CFS counts each dispatched call separately,
          so it is structurally 2&ndash;3&times; inflated relative to NIBRS:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>One real crime often generates multiple dispatches (initial 911 call, follow-up, supplemental).</li>
          <li>Many dispatches are unfounded after investigation (false alarms, mistaken reports).</li>
          <li>Some categories include non-crime calls (welfare checks, business checks, traffic complaints) that we filter, but the noise floor remains higher than NIBRS.</li>
        </ul>
        <p>
          To keep these three cities comparable to NIBRS-based cities, the per-100k rate is
          multiplied by a per-city calibration factor before grading:
        </p>
        <ul className="list-disc pl-5 space-y-1 tabular-nums">
          <li>Cleveland: <strong>&times; 0.35</strong></li>
          <li>New Orleans: <strong>&times; 0.40</strong></li>
          <li>Las Vegas: <strong>&times; 0.50</strong></li>
        </ul>
        <p>
          Factors reflect empirical CFS-to-NIBRS ratios reported in criminology literature for
          general-purpose dispatch feeds. The score card on each of these cities renders an explicit
          &ldquo;CFS-calibrated &times; <em>scale</em>&rdquo; badge so the adjustment is transparent
          to users. NIBRS-based cities are passed through with a calibration of 1.0 (no scaling).
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What the score IS</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>A descriptive summary of historical police-report volume per resident.</li>
          <li>Comparable to the FBI&apos;s published per-100,000 national rate.</li>
          <li>Reproducible: every number is derivable from the cited sources with the formula above.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What the score IS NOT</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Not a prediction of future risk.</li>
          <li>Not a measure of actual crime &mdash; only of reported and published incidents.</li>
          <li>Not a substitute for professional safety advice, emergency services, or local knowledge.</li>
          <li>
            <strong>Not</strong> a basis for housing, lending, insurance, or hiring decisions.
            Reports cluster in historically disadvantaged areas; using the score for those purposes
            risks reproducing Fair Housing Act violations.
          </li>
          <li>
            Not a characterization of neighborhoods as &ldquo;dangerous&rdquo; or &ldquo;safe&rdquo;
            &mdash; we report on incident volume, not on the character of an area or its residents.
          </li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Known limitations</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Publishing lag.</strong> City feeds can take 7&ndash;30 days to publish a report.
            The Safety Index reflects what&apos;s been published, not what&apos;s recent.
          </li>
          <li>
            <strong>Reporting bias.</strong> Areas with higher trust in police report more.
            Areas with lower trust under-report. The score reflects the reporting environment as
            much as the underlying activity.
          </li>
          <li>
            <strong>Per-neighborhood population is approximate.</strong> Polygon-area weighting
            assumes uniform density; that&apos;s false in cities with both dense downtowns and
            sprawling suburbs. We display the approximation alongside the score so users can judge
            its plausibility.
          </li>
          <li>
            <strong>NIBRS classification varies by city.</strong> Most cities follow the FBI&apos;s
            canonical Persons / Property / Society split; a few (notably Chicago) deviate (e.g.,
            classifying Robbery as Persons rather than the FBI canonical Property). We honor each
            city&apos;s own classification; comparisons across cities should factor this in.
          </li>
          <li>
            <strong>Society / public-order excluded.</strong> The FBI doesn&apos;t publish a national
            rate for Society offenses, so they can&apos;t enter the score. They&apos;re visible in
            other tabs (Crime Map, Trend Feed) for context.
          </li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Demographic data exclusion</h2>
        <p>
          TravelSafe explicitly does NOT collect, display, or analyze race, ethnicity, religion, age,
          gender, or sexual-orientation data from any source. Every adapter explicitly enumerates
          allowed fields before querying the upstream feed; demographic columns are filtered at the
          adapter layer regardless of what the city publishes. This is enforced in code; see{" "}
          <code className="text-xs">src/server/services/crime-data/adapters/</code> for the per-adapter
          field allowlists.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Individual identification</h2>
        <p>
          TravelSafe aggregates data to the neighborhood level only. Individual people are never
          identified, named, or tracked. Crime-Map drill-down dots show offense type and the block
          (street-level) where a report was published &mdash; they do not surface victim or suspect
          names. CommunitySafe posts are anonymous and run through a pre-vetter that blocks names,
          addresses below the block level, and license plates.
        </p>
      </section>

      <p className="text-xs text-slate2-500">
        See also: <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link> ·{" "}
        <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>.
      </p>
    </main>
  );
}
