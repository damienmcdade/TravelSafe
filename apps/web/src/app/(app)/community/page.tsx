"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { useTextStream } from "@/lib/use-stream";
import { useCommunityStream, relativeTime } from "@/lib/sse";
import { DataProvenanceBanner, CommunityReportedLabel, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { RiskBadge } from "@/components/RiskBadge";
import { SignInGate } from "@/components/SignInGate";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";

const REGISTRY_URL = process.env.NEXT_PUBLIC_SEX_OFFENDER_REGISTRY_URL || "https://www.meganslaw.ca.gov/";

interface Area { slug: string; label: string; jurisdiction: string }
interface AreaStats {
  area: string;
  crimeRate: number | null;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  year?: number;
  provenance: ProvenanceLike;
}
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

const KIND_LABEL: Record<PostListItem["kind"], string> = {
  HEADS_UP: "Heads-up",
  AREA_HAZARD: "Area hazard",
  LOST_FOUND: "Lost / found",
  SAFETY_NOTICE: "Safety notice",
};

export default function CommunityPage() {
  const [area, setArea] = useState<Area | null>(null);
  const areaSlug = area?.slug ?? "san-diego";

  const { data: posts, reload } = useApi<PostListItem[]>(
    area ? `/community/posts?area=${areaSlug}` : "/community/posts",
    [areaSlug],
  );
  const { data: stats } = useApi<AreaStats | null>(
    `/crime-data/area-stats?${area ? `neighborhood=${areaSlug}` : "jurisdiction=san-diego"}`,
    [areaSlug],
  );

  // Live insertion: reload feed when a new VERIFIED post lands in this area
  const [livePulse, setLivePulse] = useState(0);
  useCommunityStream((e) => {
    if (e.type === "post.verified" && (!area || e.areaSlug === areaSlug)) {
      setLivePulse((n) => n + 1);
      reload();
    }
  });

  return (
    <main className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-slate2-900">CommunitySafe</h1>
          <p className="mt-1 text-slate2-500 max-w-2xl">
            Citywide by default. Search a neighborhood, ZIP, or landmark to focus the feed.
            Reports describe <strong>behavior</strong> and <strong>place</strong> — never individuals.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <LocationSearch current={area} onResolved={setArea} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          {stats && (
            <section className="surface p-6">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-lg text-slate2-900">{stats.area}</h2>
                <RiskBadge level={stats.riskLevel} />
              </div>
              <p className="mt-2 text-sm text-slate2-700">
                {stats.crimeRate != null ? `${stats.crimeRate}/1,000 — annual rate` : "Rate unavailable"}
                {stats.year ? ` (${stats.year})` : ""}
              </p>
              <DataProvenanceBanner provenance={stats.provenance} />
            </section>
          )}

          <AreaInsightsPanel
            areaQueryString={area ? `neighborhood=${areaSlug}` : "jurisdiction=san-diego"}
          />

          <section className="surface p-6 border-amber2-500/30">
            <h2 className="font-display text-lg text-slate2-900">Official registries (link-out)</h2>
            <p className="text-sm text-slate2-700 mt-1">
              For sex-offender information, TravelSafe links to the official public registry. We do not re-host or display individuals here.
            </p>
            <a href={REGISTRY_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block underline text-slate2-900">
              Open Megan&apos;s Law (California) →
            </a>
          </section>

          <SignInGate message="Sign in to post a heads-up. We tie posts to accounts so the moderation queue can apply the rate limit and suspension ladder.">
            <PostComposer areaSlug={areaSlug} onPosted={reload} />
          </SignInGate>

          <section className="space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="font-display text-lg text-slate2-900">Verified community posts</h2>
              {livePulse > 0 && (
                <span className="text-xs text-sage-700 animate-pulse">{livePulse} new since you arrived</span>
              )}
            </header>
            {(posts ?? []).length === 0 && (
              <div className="surface-muted p-4 text-sm text-slate2-500">
                Nothing recent in this area. Most San Diego neighborhoods stay quiet most days — that&apos;s a good thing.
              </div>
            )}
            {(posts ?? []).map((p) => <PostCard key={p.id} post={p} />)}
          </section>
        </div>

        <aside className="space-y-4">
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
    <article className="surface p-5 transition-transform hover:-translate-y-0.5">
      <header className="flex justify-between items-center">
        <div className="text-xs text-slate2-500">
          {post.area.name} · {KIND_LABEL[post.kind]} · {relativeTime(post.createdAt)}
        </div>
        <CommunityReportedLabel reviewedAt={post.reviewedAt} />
      </header>
      <pre className="mt-3 whitespace-pre-wrap text-slate2-900 font-sans">{post.body}</pre>
      <footer className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => react("HELPFUL")} className="px-2 py-1 surface-muted hover:bg-sand-200 transition-colors">Helpful</button>
        <button onClick={() => react("CONFIRMED")} className="px-2 py-1 surface-muted hover:bg-sand-200 transition-colors">I saw this too</button>
        <button onClick={() => react("CONCERNED")} className="px-2 py-1 surface-muted hover:bg-sand-200 transition-colors">Concerned</button>
        <button onClick={report} className="ml-auto text-dusk-700 underline">Report this post</button>
      </footer>
    </article>
  );
}

const ACK_TEXT =
  "I confirm this report is truthful, first-hand or credible, and area-level. I understand knowingly false reports may be removed and my account suspended.";

function PostComposer({ areaSlug, onPosted }: { areaSlug: string; onPosted: () => void }) {
  const [kind, setKind] = useState<PostListItem["kind"]>("HEADS_UP");
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [when, setWhen] = useState("");
  const [ack, setAck] = useState(false);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const { text: aiFeedback, status: aiStatus, start: aiStart } = useTextStream("/ai/compose-feedback");

  // Debounced AI coaching as the user types.
  useEffect(() => {
    if (!what || !where || !when) return;
    if (what.length < 15) return;
    const id = window.setTimeout(() => {
      void aiStart({ what, where, when });
    }, 1200);
    return () => window.clearTimeout(id);
  }, [what, where, when, aiStart]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setGuidance(null);
    setSuccess(null);
    setBusy(true);
    try {
      const r = await api<{ heldForReview: boolean }>("/community/posts", {
        method: "POST",
        body: JSON.stringify({
          areaSlug, kind, what, where, when,
          acceptedDefamationNotice: true,
          acceptedText: ACK_TEXT,
        }),
      });
      setSuccess(r.heldForReview
        ? "Submitted — held for human review before it appears in the feed."
        : "Submitted — awaiting moderator verification.");
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
      <h2 className="font-display text-lg text-slate2-900">Post a heads-up</h2>
      <p className="mt-1 text-sm text-slate2-500">
        Describe what you saw, where (a landmark — not a street address), and roughly when.
        Posts about specific people, addresses, license plates, or that lead with appearance/race are blocked or held for review.
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <label className="text-sm text-slate2-700">Category</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as PostListItem["kind"])} className="mt-1 w-full px-3 py-2 surface">
            <option value="HEADS_UP">Heads-up</option>
            <option value="AREA_HAZARD">Area hazard</option>
            <option value="LOST_FOUND">Lost / found</option>
            <option value="SAFETY_NOTICE">Safety notice</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-slate2-700">What happened (behavior)</label>
          <textarea required value={what} onChange={(e) => setWhat(e.target.value)} className="mt-1 w-full px-3 py-2 surface" rows={3} />
        </div>
        <div>
          <label className="text-sm text-slate2-700">Where (landmark, not address)</label>
          <input required value={where} onChange={(e) => setWhere(e.target.value)} className="mt-1 w-full px-3 py-2 surface" />
        </div>
        <div>
          <label className="text-sm text-slate2-700">When</label>
          <input required value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 w-full px-3 py-2 surface" placeholder="e.g. Tuesday around 9pm" />
        </div>
        {(aiStatus === "streaming" || aiStatus === "done") && aiFeedback && (
          <div className="surface-muted p-3 text-sm text-slate2-700">
            <div className="text-xs text-slate2-500 mb-1">AI coach (powered by Vercel AI Gateway)</div>
            {aiFeedback}
            {aiStatus === "streaming" && <span className="ml-1 animate-pulse">▍</span>}
          </div>
        )}
        {aiStatus === "disabled" && (
          <p className="text-xs text-slate2-500">AI coaching is off — set AI_GATEWAY_API_KEY on the API to enable.</p>
        )}
        <label className="flex items-start gap-2 text-sm text-slate2-700">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          <span>{ACK_TEXT}</span>
        </label>
        <button type="submit" disabled={busy || !ack} className="px-4 py-2 bg-slate2-900 text-sand-50 rounded-xl disabled:opacity-50">
          {busy ? "Submitting…" : "Submit for review"}
        </button>
        {guidance && <p className="text-sm text-amber2-700">{guidance}</p>}
        {success && <p className="text-sm text-sage-700">{success}</p>}
      </form>
    </section>
  );
}
