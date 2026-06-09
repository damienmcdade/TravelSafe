import type { Metadata } from "next";
import { FBI_NATIONAL_PER_100K, CITIES } from "@travelsafe/crime-data";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How CommunitySafe builds the Safety Index, where the data comes from, and what the number can and can't tell you.",
};

const LAST_UPDATED = "2026-05-26";

export default function MethodologyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Methodology</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">How the Safety Index works</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
        <p className="mt-3 text-sm text-slate2-700 max-w-2xl">
          CommunitySafe turns two public datasets into one easy-to-read 0&ndash;100 number. It is
          simple math, not a prediction. This page is the official explanation. If anything in the
          app says something different, the app is wrong and we will fix it.
        </p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Data sources</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong className="text-slate2-900">City open-data sites.</strong> Each of CommunitySafe&apos;s
            {" "}{CITIES.length} cities posts its own police reports on an official public website
            (for example: San Diego Police, Los Angeles Police, San Francisco Police, Chicago Police,
            New York Police, Seattle Police, Boston Police, DC Police, and Philadelphia Police. See the
            Cities directory for all {CITIES.length}.) We pull the reports straight from the same public
            source the city itself uses.
          </li>
          <li>
            <strong className="text-slate2-900">{FBI_DATA_LABEL}.</strong> The national average we
            compare each city against. It is shown as the number of reports per 100,000 people, so big
            and small cities can be compared fairly. Violent (Persons): {FBI_NATIONAL_PER_100K.PERSONS.toLocaleString()},
            Property: {FBI_NATIONAL_PER_100K.PROPERTY.toLocaleString()}.
            Source:{" "}
            <a
              href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend"
              target="_blank" rel="noreferrer"
              className="text-bay-700 hover:underline"
            >
              cde.ucr.cjis.gov
            </a>
            . The FBI puts out new numbers every October, and we update ours to match.
          </li>
          <li>
            <strong className="text-slate2-900">US Census 2023-2024 population estimates.</strong> The
            population count we use to work out reports per 100,000 people. Source:{" "}
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
            police report the city has posted recently (usually the last 30 to 180 days). We sort them
            into the two groups the FBI publishes a national average for: Violent (Persons) and Property.
            Other offenses (public-order ones like drug or weapon offenses) are still tracked, but they
            don&apos;t count toward the score because the FBI has no national average for them.
          </li>
          <li>
            <strong className="text-slate2-900">Estimate how many people live there.</strong> For a
            whole city, we use its real US Census 2023-2024 population. For a single neighborhood, we
            estimate the population in one of two ways:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <em>By size (preferred):</em> we take the city&apos;s population and give each
                neighborhood a share based on how much of the city&apos;s land it covers, using the
                city&apos;s official neighborhood map. This assumes people are spread out evenly. It is
                close enough to rank neighborhoods against each other, but it is an estimate, not a
                census count.
              </li>
              <li>
                <em>By share of reports (backup):</em> when we don&apos;t have a neighborhood map, we
                start from the city&apos;s rate and adjust it by how busy the neighborhood is compared
                to the average. A neighborhood with an average number of reports gets the city&apos;s
                rate. One with twice as many reports gets twice the rate.
              </li>
            </ul>
          </li>
          <li>
            <strong className="text-slate2-900">Turn it into a yearly rate per 100,000 people.</strong>{" "}
            We scale the recent count up to a full year, then divide by population and multiply by
            100,000: (reports &times; 365 &divide; days counted &divide; population) &times; 100,000.
            This is the same unit the FBI uses to compare cities to the national average.
          </li>
          <li>
            <strong className="text-slate2-900">Compare it to the fairest baseline.</strong> A
            neighborhood&apos;s grade is compared to its OWN city&apos;s rate, not the national average.
            Here&apos;s why. The national average mixes together rural, suburban, and city areas. Cities
            tend to have more reports than rural areas, and busy neighborhoods have even more. So comparing
            a single city neighborhood straight to the national average would make almost every
            neighborhood look worse than it really is. Comparing it to its own city is fairer. We still
            show the national average too, so you can see how each city stacks up against the country. For
            a whole city&apos;s score, the national average IS the fair comparison, so that is what we use.
          </li>
        </ol>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">An adjustment for three cities</h2>
        <p>
          Three cities &mdash; <strong>Cleveland</strong>, <strong>New Orleans</strong>, and{" "}
          <strong>Las Vegas</strong> &mdash; only publish <em>911 calls</em> rather than finished
          crime reports. Counting calls tends to roughly double or triple the numbers, because:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>One real crime often sparks several calls (the first 911 call, follow-ups, and so on).</li>
          <li>Many calls turn out to be nothing after police look into them (false alarms, mistakes).</li>
          <li>Some calls aren&apos;t crimes at all (welfare checks, traffic complaints). We filter those out, but the count still runs higher than a finished-report city.</li>
        </ul>
        <p>
          So that those three cities don&apos;t look unfairly worse, we shrink their rate by a set amount
          before grading:
        </p>
        <ul className="list-disc pl-5 space-y-1 tabular-nums">
          <li>Cleveland: <strong>&times; 0.35</strong></li>
          <li>New Orleans: <strong>&times; 0.40</strong></li>
          <li>Las Vegas: <strong>&times; 0.50</strong></li>
        </ul>
        <p>
          These adjustments come from studies that compared 911-call counts to finished crime reports.
          Each of these cities shows a clear &ldquo;adjusted&rdquo; badge on its score card so you can
          see the change. All other cities are left exactly as-is (no adjustment).
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What the score IS</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>A simple summary of how many police reports there have been per resident.</li>
          <li>Built to line up with the FBI&apos;s national rate per 100,000 people.</li>
          <li>Checkable: you can recreate every number from the sources above using the steps above.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What the score IS NOT</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Not a prediction of what will happen next.</li>
          <li>Not a count of all crime. It only counts crimes that were reported and published.</li>
          <li>Not a replacement for professional safety advice, 911, or local know-how.</li>
          <li>
            <strong>Not</strong> something to base housing, lending, insurance, or hiring decisions
            on. Reports pile up in areas that have long been treated unfairly. Using the score this
            way can break the Fair Housing Act.
          </li>
          <li>
            Not a label of any neighborhood as &ldquo;dangerous&rdquo; or &ldquo;safe.&rdquo; We count
            reports, not the character of a place or the people who live there.
          </li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Known limitations</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Reports take time to appear.</strong> Cities can take 7 to 30 days to post a
            report. The score reflects what has been posted, which may not be the very latest.
          </li>
          <li>
            <strong>Some areas report more than others.</strong> Where people trust the police, more
            crimes get reported. Where trust is lower, fewer do. So the score partly reflects how much
            people report, not just what actually happens.
          </li>
          <li>
            <strong>Neighborhood population is an estimate.</strong> Splitting people up by land area
            assumes everyone is spread out evenly, which isn&apos;t true in cities with a packed
            downtown and spread-out suburbs. We show the estimate next to the score so you can judge it.
          </li>
          <li>
            <strong>Cities sort crimes a little differently.</strong> Most cities use the FBI&apos;s
            standard Persons / Property / Other groupings. A few (notably Chicago) sort some crimes
            differently (for example, counting robbery as Persons instead of Property). We use each
            city&apos;s own sorting, so keep that in mind when comparing cities.
          </li>
          <li>
            <strong>Other offenses don&apos;t count toward the score.</strong> The FBI has no national
            average for public-order offenses, so they can&apos;t be part of the score. You can still
            see them in other tabs (Crime Map, Trend Feed).
          </li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Demographic data exclusion</h2>
        <p>
          CommunitySafe does NOT collect, show, or analyze race, ethnicity, religion, age, gender, or
          sexual orientation from any source. Before we pull data from a city, our code lists exactly
          which fields it is allowed to read, and demographic columns are dropped no matter what the
          city publishes. This is built into the code. See{" "}
          <code className="text-xs">src/server/services/crime-data/adapters/</code> for the list of
          allowed fields per city.
        </p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Individual identification</h2>
        <p>
          CommunitySafe only groups data down to the neighborhood level. We never name, identify, or
          track individual people. On the Crime Map, each dot shows the type of offense and the block
          where a report was filed. It never shows victim or suspect names. CommunitySafe posts are
          anonymous and pass through a check that blocks names, exact addresses, and license plates.
        </p>
      </section>

      <LegalFooter />
    </main>
  );
}
