"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { useTextStream } from "@/lib/use-stream";
import { useCommunityStream, relativeTime } from "@/lib/sse";
import { DataProvenanceBanner, CommunityReportedLabel, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import { RecentIncidentsCards } from "@/components/RecentIncidentsCards";
import { NewsPanel } from "@/components/NewsPanel";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { CityBanner } from "@/components/CitySelector";
import { useCity } from "@/lib/use-city";

const REGISTRY_URL = process.env.NEXT_PUBLIC_SEX_OFFENDER_REGISTRY_URL || "https://www.meganslaw.ca.gov/";

interface Area { slug: string; label: string; jurisdiction: string }
interface AreaStats { area: string; crimeRate: number | null; riskLevel: 1|2|3|4|5; year?: number; provenance: ProvenanceLike }
interface PostListItem {
  id: string;
  body: string;
  kind: "HEADS_UP" | "AREA_HAZARD" | "LOST_FOUND" | "SAFETY_NOTICE";
  createdAt: string;
  reviewedAt: string | null;
  area: { id: string; name: string; slug: string };
  author: { id: string; displayName: string | null };
  _count: { comments: number; reactions: number };
}
interface PerArea { slug: string; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number } }
interface Citywide { perArea: PerArea[] }

const KIND_LABEL: Record<PostListItem["kind"], string> = {
  HEADS_UP: "Heads-up",
  AREA_HAZARD: "Area hazard",
  LOST_FOUND: "Lost / found",
  SAFETY_NOTICE: "Safety notice",
};

const KIND_TONE: Record<PostListItem["kind"], string> = {
  HEADS_UP: "border-l-amber2-500",
  AREA_HAZARD: "border-l-coral-500",
  LOST_FOUND: "border-l-bay-500",
  SAFETY_NOTICE: "border-l-sage-500",
};

export default function CommunityPage() {
  const { city } = useCity();
  const [area, setArea] = useState<Area | null>(null);
  useEffect(() => { setArea(null); }, [city.slug]);
  const areaSlug = area?.slug ?? city.defaultArea;

  const { data: posts, reload } = useApi<PostListItem[]>(
    area ? `/community/posts?area=${areaSlug}` : "/community/posts",
    [areaSlug],
  );
  const { data: stats } = useApi<AreaStats | null>(
    `/crime-data/area-stats?${area ? `neighborhood=${areaSlug}` : `jurisdiction=${city.defaultArea}`}`,
    [areaSlug, city.slug],
  );
  const { data: citywide } = useApi<Citywide>(`/crime-data/citywide?city=${city.slug}`, [city.slug]);

  const counts = (() => {
    if (!citywide) return { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    if (area) return citywide.perArea.find((p) => p.slug === area.slug)?.byCategory ?? { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    return citywide.perArea.reduce(
      (acc, p) => ({ PERSONS: acc.PERSONS + p.byCategory.PERSONS, PROPERTY: acc.PROPERTY + p.byCategory.PROPERTY, SOCIETY: acc.SOCIETY + p.byCategory.SOCIETY }),
      { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
    );
  })();

  const [livePulse, setLivePulse] = useState(0);
  useCommunityStream((e) => {
    if (e.type === "post.verified" && (!area || e.areaSlug === areaSlug)) {
      setLivePulse((n) => n + 1);
      reload();
    }
  });

  return (
    <main className="space-y-8">
      <header className="page-hero flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-coral-700 font-medium">CommunitySafe</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            Verified neighbor reports, side-by-side with the data
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            {city.label} by default. Search a neighborhood, ZIP, or landmark to focus the feed.
            Headlines, official alerts, and police incidents flank every post.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <CityBanner />

      <LocationSearch current={area} onResolved={setArea} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          {/* Neighbor reports first — primary purpose of the tab. */}
          <section className="space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="font-display text-xl text-slate2-900">Neighbor reports</h2>
              {livePulse > 0 && <span className="text-xs text-sage-700 animate-pulse">{livePulse} new since you arrived</span>}
            </header>
            {(posts ?? []).length === 0 && (
              <div className="surface-muted p-4 text-sm text-slate2-500">
                No posts yet for this area. Share the first heads-up below — anonymous, no sign-in required.
              </div>
            )}
            {(posts ?? []).map((p) => <PostCard key={p.id} post={p} />)}
          </section>

          {/* Anonymous composer directly under the feed. */}
          <PostComposer areaSlug={areaSlug} onPosted={reload} />

          {/* Supporting context below the social surface. */}
          <AreaInsightsPanel areaQueryString={area ? `neighborhood=${areaSlug}` : `jurisdiction=${city.defaultArea}`} />
          <CategoryBreakdown
            counts={counts}
            title={area ? `${area.label} — incident mix` : `${city.label} incident mix`}
            subtitle={`${city.label} police data, recent cached window.`}
          />
          <CrimeMixCard
            areaSlug={area?.slug}
            jurisdictionSlug={!area ? city.defaultArea : undefined}
            title={area ? `${area.label} — specific offenses, last 30 days` : `${city.label} specific offenses, last 30 days`}
          />
          <RecentIncidentsCards
            area={area?.slug}
            jurisdiction={!area ? city.defaultArea : undefined}
            title={area ? `Recently reported in ${area.label}` : `Recently reported across ${city.label}`}
          />

          <section className="surface p-6 border-amber2-500/30">
            <h2 className="font-display text-lg text-slate2-900">Official registries</h2>
            <p className="text-sm text-slate2-700 mt-1">
              For sex-offender information, TravelSafe links to the official public registry. We do not re-host or display individuals here.
            </p>
            <a href={REGISTRY_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block underline text-slate2-900 hover:text-bay-700 transition-colors">
              Open Megan&apos;s Law (California) →
            </a>
          </section>

          <DataProvenanceBanner provenance={stats?.provenance ?? null} />
        </div>
        <aside className="space-y-4">
          <NewsPanel areaSlug={area?.slug ?? city.slug} />
          <OfficialAlertsPanel />
        </aside>
      </div>
    </main>
  );
}

function PostCard({ post }: { post: PostListItem }) {
  async function report() {
    await api(`/moderation/posts/${post.id}/report`, { method: "POST", body: JSON.stringify({}) });
    alert("Reported — a moderator will re-review.");
  }
  async function react(kind: "HELPFUL" | "CONFIRMED" | "CONCERNED") {
    await api(`/community/posts/${post.id}/react`, { method: "POST", body: JSON.stringify({ kind }) });
  }
  return (
    <article className={`surface p-5 border-l-4 ${KIND_TONE[post.kind]} transition-transform hover:-translate-y-0.5 animate-rise-in`}>
      <header className="flex justify-between items-center text-xs">
        <span className="text-slate2-700">{post.area.name} · <span className="text-bay-700 font-medium">{KIND_LABEL[post.kind]}</span> · {relativeTime(post.createdAt)}</span>
        <CommunityReportedLabel reviewedAt={post.reviewedAt} />
      </header>
      <pre className="mt-3 whitespace-pre-wrap text-slate2-900 font-sans">{post.body}</pre>
      <footer className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => react("HELPFUL")} className="px-2.5 py-1 surface-muted hover:bg-bay-200 hover:text-bay-700 transition-all">Helpful</button>
        <button onClick={() => react("CONFIRMED")} className="px-2.5 py-1 surface-muted hover:bg-sage-200 hover:text-sage-700 transition-all">I saw this too</button>
        <button onClick={() => react("CONCERNED")} className="px-2.5 py-1 surface-muted hover:bg-amber2-200 hover:text-amber2-700 transition-all">Concerned</button>
        <button onClick={report} className="ml-auto text-dusk-700 underline hover:text-dusk-500">Report this post</button>
      </footer>
    </article>
  );
}

function PostComposer({ areaSlug, onPosted }: { areaSlug: string; onPosted: () => void }) {
  const [kind, setKind] = useState<PostListItem["kind"]>("HEADS_UP");
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [when, setWhen] = useState("");
  const [guidance, setGuidance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const { text: aiFeedback, status: aiStatus, start: aiStart } = useTextStream("/ai/compose-feedback");

  useEffect(() => {
    if (!what || !where || !when) return;
    if (what.length < 15) return;
    const id = window.setTimeout(() => void aiStart({ what, where, when }), 1200);
    return () => window.clearTimeout(id);
  }, [what, where, when, aiStart]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setGuidance(null);
    setSuccess(null);
    setBusy(true);
    try {
      await api<{ autoPublished: boolean }>("/community/posts", {
        method: "POST",
        body: JSON.stringify({ areaSlug, kind, what, where, when }),
      });
      setSuccess("Posted. Thanks for sharing.");
      setWhat(""); setWhere(""); setWhen("");
      onPosted();
    } catch (err) {
      const e = err as Error & { body?: { guidance?: string } };
      setGuidance(e.body?.guidance ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface p-6">
      <h2 className="font-display text-lg text-slate2-900">Share a heads-up (anonymous)</h2>
      <p className="mt-1 text-sm text-slate2-500">
        No sign-in needed. Describe <strong>what you saw</strong>, <strong>where</strong>, and <strong>when</strong>. The application blocks only posts that contain profanity, slurs, or threats of violence — everything else publishes immediately.
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <label className="text-sm text-slate2-700">Category</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as PostListItem["kind"])} className="mt-1 input">
            <option value="HEADS_UP">Heads-up — something to be aware of</option>
            <option value="AREA_HAZARD">Area hazard — physical / environmental</option>
            <option value="LOST_FOUND">Lost / found — items or pets only</option>
            <option value="SAFETY_NOTICE">Safety notice — general info for the area</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-slate2-700">What happened (behavior)</label>
          <textarea required value={what} onChange={(e) => setWhat(e.target.value)} className="mt-1 input" rows={3} placeholder="e.g. multiple cars had their windows smashed overnight" />
        </div>
        <div>
          <label className="text-sm text-slate2-700">Where (landmark, not address)</label>
          <input required value={where} onChange={(e) => setWhere(e.target.value)} className="mt-1 input" placeholder="e.g. parking lot behind the Belmont Park area" />
        </div>
        <div>
          <label className="text-sm text-slate2-700">When</label>
          <input required value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 input" placeholder="e.g. Tuesday around 9pm" />
        </div>
        {(aiStatus === "streaming" || aiStatus === "done") && aiFeedback && (
          <div className="surface-muted p-3 text-sm text-slate2-700">
            <div className="text-xs text-slate2-500 mb-1">AI coach (Vercel AI Gateway)</div>
            {aiFeedback}
            {aiStatus === "streaming" && <span className="ml-1 animate-pulse">▍</span>}
          </div>
        )}
        {aiStatus === "disabled" && (
          <p className="text-xs text-slate2-500">AI coaching is off — set <code>AI_GATEWAY_API_KEY</code> on Vercel to enable.</p>
        )}
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
          {busy ? "Posting…" : "Post anonymously"}
        </button>
        {guidance && <p className="text-sm text-amber2-700">{guidance}</p>}
        {success && <p className="text-sm text-sage-700">{success}</p>}
      </form>
    </section>
  );
}
