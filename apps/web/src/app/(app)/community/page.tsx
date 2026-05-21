"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { DataProvenanceBanner, CommunityReportedLabel, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { RiskBadge } from "@/components/RiskBadge";
import { SignInGate } from "@/components/SignInGate";

const REGISTRY_URL = process.env.NEXT_PUBLIC_SEX_OFFENDER_REGISTRY_URL || "https://www.meganslaw.ca.gov/";

interface Area { id: string; slug: string; name: string }
interface AreaStats {
  area: string;
  crimeRate: number | null;
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
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
  area: Area;
  author: { id: string; displayName: string | null };
  _count: { comments: number; reactions: number };
}

export default function CommunityPage() {
  const { data: areas } = useApi<Area[]>("/neighborhood/");
  const [areaSlug, setAreaSlug] = useState("pacific-beach");
  const { data: posts, reload } = useApi<PostListItem[]>(`/community/posts?area=${areaSlug}`, [areaSlug]);
  const { data: stats } = useApi<AreaStats | null>(`/crime-data/area-stats?neighborhood=${areaSlug}`, [areaSlug]);

  return (
    <main className="space-y-8">
      <header>
        <h1 className="font-display text-3xl text-slate2-900">CommunitySafe</h1>
        <p className="mt-2 text-slate2-500 max-w-2xl">
          Neighborhood-level feed. Reports describe <strong>behavior</strong> and <strong>place</strong> — never individuals.
          Posts are reviewed before they appear here.
        </p>
      </header>

      <section className="surface p-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate2-700">City Scanner — area</label>
        <select
          value={areaSlug}
          onChange={(e) => setAreaSlug(e.target.value)}
          className="px-3 py-2 surface"
        >
          {(areas ?? []).map((a) => (
            <option key={a.id} value={a.slug}>{a.name}</option>
          ))}
        </select>
      </section>

      {stats && (
        <section className="surface p-6">
          <h2 className="font-display text-lg text-slate2-900">{stats.area}</h2>
          <div className="mt-2 flex items-center gap-3">
            <RiskBadge level={stats.riskLevel} />
            <span className="text-sm text-slate2-700">
              {stats.crimeRate != null ? `${stats.crimeRate}/1,000 — annual rate` : "Rate unavailable"}
              {stats.year ? ` (${stats.year})` : ""}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate2-500">
            Context: this is the latest annual rate published by the source — not live data.
            Most San Diego neighborhoods stay close to their long-term baseline most of the time.
          </p>
          <DataProvenanceBanner provenance={stats.provenance} />
        </section>
      )}

      <section className="surface p-6 border-amber2-500/30">
        <h2 className="font-display text-lg text-slate2-900">Official registries (link-out)</h2>
        <p className="text-sm text-slate2-700 mt-1">
          For sex-offender information, TravelSafe links to the official public registry. We do not re-host or display individuals here.
        </p>
        <a href={REGISTRY_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block underline text-slate2-900">
          Open Megan&apos;s Law (California) →
        </a>
      </section>

      <SignInGate message="Sign in to post a heads-up. We tie posts to accounts so the moderation queue can apply the rate limit and the suspension ladder.">
        <PostComposer areaSlug={areaSlug} onPosted={reload} />
      </SignInGate>

      <section className="space-y-3">
        <h2 className="font-display text-lg text-slate2-900">Verified community posts</h2>
        {(posts ?? []).length === 0 && <p className="text-slate2-500 text-sm">Nothing recent in this area.</p>}
        {(posts ?? []).map((p) => <PostCard key={p.id} post={p} />)}
      </section>
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
    <article className="surface p-5">
      <header className="flex justify-between items-center">
        <div className="text-xs text-slate2-500">
          {post.area.name} · {KIND_LABEL[post.kind]}
        </div>
        <CommunityReportedLabel reviewedAt={post.reviewedAt} />
      </header>
      <pre className="mt-3 whitespace-pre-wrap text-slate2-900 font-sans">{post.body}</pre>
      <footer className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => react("HELPFUL")} className="px-2 py-1 surface-muted">Helpful</button>
        <button onClick={() => react("CONFIRMED")} className="px-2 py-1 surface-muted">I saw this too</button>
        <button onClick={() => react("CONCERNED")} className="px-2 py-1 surface-muted">Concerned</button>
        <button onClick={report} className="ml-auto text-dusk-700 underline">Report this post</button>
      </footer>
    </article>
  );
}

const KIND_LABEL: Record<PostListItem["kind"], string> = {
  HEADS_UP: "Heads-up",
  AREA_HAZARD: "Area hazard",
  LOST_FOUND: "Lost / found",
  SAFETY_NOTICE: "Safety notice",
};

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
