"use client";
import { useApi } from "@/lib/api-client";

interface Tip {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  group: "prevention" | "self-defense" | "ca-legal";
  relevance: number;
}
interface Resp {
  area: string;
  city: { slug: string; label: string };
  nonEmergency: { line: string; label: string; url: string };
  basedOn: { dominantCategory: string | null; topOffense?: string };
  prevention: Tip[];
  selfDefense: Tip[];
  caLegal: Tip[];
  disclaimer: string;
}

export function SafetyTipsPanel({ areaSlug, jurisdictionSlug }: { areaSlug?: string; jurisdictionSlug?: string }) {
  const path = areaSlug
    ? `/safety/tips?neighborhood=${areaSlug}`
    : jurisdictionSlug
    ? `/safety/tips?jurisdiction=${jurisdictionSlug}`
    : "/safety/tips?jurisdiction=san-diego";
  const { data, loading, error } = useApi<Resp>(path, [path]);

  return (
    <section className="space-y-6">
      <header className="surface p-6 bg-gradient-to-br from-bay-50 via-white to-coral-200/30">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="font-display text-xl text-slate2-900">Practical guidance for {data?.city.label ?? "your area"}</h2>
          {data?.basedOn.topOffense && <span className="text-xs text-slate2-500">Based on the most-reported offense: {data.basedOn.topOffense}</span>}
        </div>
        <p className="mt-2 text-sm text-slate2-700">
          The cards below are organized into three sections: practical prevention, personal self-defense principles, and a summary of California law. All material is drawn from official agency guidance or California statute.
        </p>
        {data?.nonEmergency && (
          <p className="mt-3 text-sm text-slate2-700">
            <strong>{data.city.label} non-emergency police:</strong>{" "}
            <a href={`tel:${data.nonEmergency.line.replace(/[^0-9+]/g, "")}`} className="text-bay-700 font-medium hover:underline">{data.nonEmergency.line}</a>{" "}
            (<a href={data.nonEmergency.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">{data.nonEmergency.label}</a>).
            For emergencies, dial 911.
          </p>
        )}
      </header>

      {loading && <SkeletonGrid />}
      {error && !loading && <p className="surface p-4 text-sm text-dusk-700">Could not load tips for {data?.city.label ?? "this area"}.</p>}

      {!loading && data && (
        <>
          <Section title="Prevention tips for this area" subtitle="Matched to the offenses most commonly reported here." tips={data.prevention} />
          <Section title="Self-defense principles" subtitle="Layered awareness and de-escalation come first. Physical defense is a last resort." tips={data.selfDefense} />
          <Section title="California law: what is legal and what is not" subtitle="Plain-language summary of state statutes that govern personal defense in California." tips={data.caLegal} />

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug">
            {data.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}

function Section({ title, subtitle, tips }: { title: string; subtitle: string; tips: Tip[] }) {
  if (!tips.length) return null;
  return (
    <section>
      <header className="mb-3">
        <h3 className="font-display text-lg text-slate2-900">{title}</h3>
        <p className="text-xs text-slate2-500 mt-0.5">{subtitle}</p>
      </header>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tips.map((t) => (
          <li key={t.id}>
            <article className="surface p-4 h-full bg-gradient-to-br from-white to-sand-50 hover:shadow-glow-bay transition-all animate-rise-in">
              <h4 className="font-display text-base text-slate2-900">{t.title}</h4>
              <p className="mt-1.5 text-sm text-slate2-700 leading-snug">{t.body}</p>
              <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-bay-700 hover:underline">
                Source: {t.source} →
              </a>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="surface p-4 space-y-2"><div className="skel h-4 w-2/3" /><div className="skel h-3 w-full" /><div className="skel h-3 w-5/6" /></li>
      ))}
    </ul>
  );
}
