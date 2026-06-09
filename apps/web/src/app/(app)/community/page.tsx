"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useTextStream } from "@/lib/use-stream";
import { useCommunityStream, relativeTime } from "@/lib/sse";
import { DataProvenanceBanner, CommunityReportedLabel, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { TrustBadge } from "@/components/TrustBadge";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { CommunitySignalsPanel } from "@/components/CommunitySignalsPanel";
import { useCity } from "@/lib/use-city";

interface AreaStats { area: string; crimeRate: number | null; riskLevel: 1|2|3|4|5; year?: number; provenance: ProvenanceLike }
interface PostListItem {
  id: string;
  body: string;
  imageUrl?: string | null;
  kind: "HEADS_UP" | "AREA_HAZARD" | "LOST_FOUND" | "SAFETY_NOTICE";
  createdAt: string;
  reviewedAt: string | null;
  area: { id: string; name: string; slug: string };
  author: { displayName: string | null; trustLevel?: "NEW" | "REGULAR" | "TRUSTED" | "MODERATOR" };
  _count: { comments: number; reactions: number };
}
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
  // Globally-shared neighborhood selection — keeps CommunitySafe in lockstep
  // with Awareness, SafeZone, Trend Feed, Personal Safety, etc.
  const { area, setArea } = useArea(city.slug);
  useDocumentTitle(`CommunitySafe · ${area?.label ?? city.label}`);

  // P0 INCIDENT (2026-05-22) class of bug: never substitute `city.defaultArea`
  // for the area slug. For several cities (san-diego, cin-downtown, lv-
  // downtown, etc.) defaultArea is a synthetic placeholder that the
  // adapter doesn't recognize — querying with it returns an empty result
  // set that looks like "sync didn't carry over the picked neighborhood"
  // when really we sent the wrong slug.
  //
  // Posts query: when no area is picked, scope by city slug instead so
  // we still filter out other cities' posts. The server understands
  // `?city=<slug>` for citywide post listings.
  const postsPath = area
    ? `/community/posts?area=${encodeURIComponent(area.slug)}`
    : `/community/posts?city=${encodeURIComponent(city.slug)}`;
  const { data: posts, reload, error: postsError } = useApi<PostListItem[]>(
    postsPath,
    [postsPath],
  );
  // v64 — fallback feed when the selected area/city has no posts yet.
  // Without this the Connections tab shows just "No posts yet" with no
  // content (the seed posts only exist in Pacific Beach, so every
  // non-SD user saw an empty tab). Loading the global feed in the
  // background gives users immediate content to read while still
  // encouraging them to be the first to post in their own area.
  const globalEmpty = !postsError && (posts ?? []).length === 0;
  const { data: globalPosts } = useApi<PostListItem[]>(
    globalEmpty ? "/community/posts" : null,
    [globalEmpty],
  );
  // area-stats: only query when an area is actually selected. The
  // citywide view doesn't need a per-area stats card; the citywide
  // aggregate below covers that case.
  const { data: stats } = useApi<AreaStats | null>(
    area ? `/crime-data/area-stats?neighborhood=${encodeURIComponent(area.slug)}` : null,
    [area?.slug ?? ""],
  );
  // citywide aggregate + CategoryBreakdown + CrimeMixCard previously
  // duplicated the same data already shown on /threats (Awareness in
  // the Browse workflow). Per the Option-2 IA, those cards now live in
  // exactly one tab; /community focuses on the social/posts side and
  // cross-links to /threats for the awareness widgets.

  const [livePulse, setLivePulse] = useState(0);
  useCommunityStream((e) => {
    // Pulse fires when a new post is verified for the area we're
    // showing. When no area is picked we're in citywide mode, so any
    // post in this city counts (server-side stream events scope by
    // city in that case).
    if (e.type === "post.verified" && (!area || e.areaSlug === area.slug)) {
      setLivePulse((n) => n + 1);
      reload();
    }
  });

  return (
    <main className="space-y-5">
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

      <aside role="note" className="surface-muted px-4 py-3 text-xs text-slate2-700 leading-snug">
        Posts here are user-submitted observations, not professional safety advice and not a substitute for 911.
        Reports are area-level; CommunitySafe never identifies, tracks, or geolocates individual people.
        In an emergency, call 911.
      </aside>

      <LocationSearch current={area} onResolved={setArea} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          {/* Neighbor reports first — primary purpose of the tab. */}
          <section className="space-y-3">
            <header className="flex items-center justify-between">
              <h2 className="font-display text-xl text-slate2-900">Neighbor reports</h2>
              {livePulse > 0 && (
                <span className="text-xs text-sage-700 animate-pulse" aria-live="polite">
                  {livePulse} new since you arrived
                </span>
              )}
            </header>
            {postsError && !posts && (
              <div className="surface p-4 text-sm text-dusk-700" role="alert">
                Couldn&apos;t load community posts right now. Try again in a moment.
              </div>
            )}
            {!postsError && (posts ?? []).length === 0 && (
              <div className="surface-muted p-4 text-sm text-slate2-500">
                No posts yet for {area?.label ?? city.label}. Share the first heads-up below — anonymous, no sign-in required.
              </div>
            )}
            {(posts ?? []).map((p) => <PostCard key={p.id} post={p} />)}
            {/* v64 — global fallback when the current area/city has no
                posts. Header makes clear these are from across
                CommunitySafe, not the user's selected area, so they
                aren't mistaken for local activity. */}
            {globalEmpty && (globalPosts ?? []).length > 0 && (
              <section className="space-y-2 mt-4">
                <header className="flex items-baseline justify-between">
                  <h3 className="font-display text-sm text-slate2-900">Recent posts from across CommunitySafe</h3>
                  <span className="text-xs text-slate2-500">{(globalPosts ?? []).length} shown</span>
                </header>
                <p className="text-xs text-slate2-500">
                  These are heads-ups from other neighborhoods. Pick your area above to filter, or post the first one for {area?.label ?? city.label} below.
                </p>
                {(globalPosts ?? []).slice(0, 5).map((p) => <PostCard key={p.id} post={p} />)}
              </section>
            )}
          </section>

          {/* Anonymous composer directly under the feed. Composer requires
              an area to post against — if none is picked, the composer
              prompts the user to pick one rather than defaulting to a
              broken city-slug-as-area. */}
          {area
            ? <PostComposer areaSlug={area.slug} onPosted={reload} />
            : (
              <section className="surface-muted p-4 text-sm text-slate2-700">
                Pick a {city.label} neighborhood above to post a heads-up. Anonymous, no sign-in required.
              </section>
            )}

          {/* Per-neighborhood community signals from the city's subreddit.
              Only renders when an area is picked — citywide subreddit
              signals don't map cleanly to a single feed. */}
          {area && <CommunitySignalsPanel areaSlug={area.slug} />}

          {/* Insights panel only renders when an area is picked — the
              insights service queries per-area, doesn't have a real
              citywide aggregate yet. Kept on /community because it
              contextualizes the neighbor-report feed (e.g. "this week's
              uptick mirrors what neighbors are flagging"). */}
          {area && <AreaInsightsPanel areaQueryString={`neighborhood=${encodeURIComponent(area.slug)}`} />}

          {/* "Recently reported in <area>" card + title removed per
              v7 directive — Connections now focuses on neighbor-led
              posts; the published-police feed lives on Neighborhood
              Awareness's ThreatFeed where it belongs. */}

          {/* Official registries card moved to Personal Safety
              sub-tab on Neighborhood Awareness per v7 directive —
              registry lookups are a personal-safety tool, not a
              community-discussion surface.

              "Looking for news + official alerts?" cross-link
              removed — the news + alerts cards live on City
              Awareness only, and a redundant pointer card on
              Connections was noise. */}

          <DataProvenanceBanner provenance={stats?.provenance ?? null} />
        </div>
        <aside className="space-y-4">
        </aside>
      </div>
    </main>
  );
}

function PostCard({ post }: { post: PostListItem }) {
  // Track which action is in flight (or null when idle). One slot is
  // enough because the API calls are mutually exclusive — a user wouldn't
  // be reacting AND reporting simultaneously.
  const [busy, setBusy] = useState<"HELPFUL" | "CONFIRMED" | "CONCERNED" | "REPORT" | null>(null);
  const [confirmed, setConfirmed] = useState<"HELPFUL" | "CONFIRMED" | "CONCERNED" | "REPORT" | null>(null);
  // fix(audit ui-community-react-report-no-catch): react/report had try/finally
  // with NO catch, so a failed API call silently reset the button to idle and the
  // user couldn't tell their reaction/report didn't land. Surface the failure.
  const [error, setError] = useState<string | null>(null);

  async function report() {
    if (busy) return;
    setBusy("REPORT");
    setError(null);
    try {
      await api(`/moderation/posts/${post.id}/report`, { method: "POST", body: JSON.stringify({}) });
      // The button itself flips to "Reported ✓" via setConfirmed below
      // — no need for a native alert(), which steals focus on iOS and
      // shows the bare hostname as a confidence-killing last impression.
      setConfirmed("REPORT");
    } catch (err) {
      setError(`Couldn't submit your report — ${(err as Error).message}. Try again.`);
    } finally {
      setBusy(null);
    }
  }
  async function react(kind: "HELPFUL" | "CONFIRMED" | "CONCERNED") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await api(`/community/posts/${post.id}/react`, { method: "POST", body: JSON.stringify({ kind }) });
      setConfirmed(kind);
    } catch (err) {
      setError(`Couldn't save your reaction — ${(err as Error).message}. Try again.`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <article className={`surface p-5 border-l-4 ${KIND_TONE[post.kind]} transition-transform hover:-translate-y-0.5 animate-rise-in`}>
      <header className="flex justify-between items-center gap-2 text-xs flex-wrap">
        <span className="text-slate2-700 flex items-center gap-1.5 flex-wrap">
          {post.area.name}
          <span className="text-slate2-500">·</span>
          <span className="text-bay-700 font-medium">{KIND_LABEL[post.kind]}</span>
          <span className="text-slate2-500">·</span>
          <span>{relativeTime(post.createdAt)}</span>
          {/* Trust badge sits inline with the post chrome — readers
              can weigh a NEW contributor's claim against a TRUSTED
              one. NEW renders as nothing per TrustBadge's own logic. */}
          {post.author.trustLevel && post.author.trustLevel !== "NEW" && (
            <TrustBadge level={post.author.trustLevel} />
          )}
        </span>
        <CommunityReportedLabel reviewedAt={post.reviewedAt} />
      </header>
      <pre className="mt-3 whitespace-pre-wrap text-slate2-900 font-sans">{post.body}</pre>
      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt="Photo attached to this community post"
          loading="lazy"
          className="mt-3 rounded-xl max-h-96 w-auto object-contain border border-bay-100"
        />
      )}
      <footer className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <ReactButton onClick={() => react("HELPFUL")}    busy={busy === "HELPFUL"}   done={confirmed === "HELPFUL"}   color="bay">Helpful</ReactButton>
        <ReactButton onClick={() => react("CONFIRMED")}  busy={busy === "CONFIRMED"} done={confirmed === "CONFIRMED"} color="sage">I saw this too</ReactButton>
        <ReactButton onClick={() => react("CONCERNED")}  busy={busy === "CONCERNED"} done={confirmed === "CONCERNED"} color="amber2">Concerned</ReactButton>
        <button
          onClick={report}
          disabled={busy != null}
          className="ml-auto text-dusk-700 underline hover:text-dusk-500 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy === "REPORT" ? "Reporting…" : confirmed === "REPORT" ? "Reported ✓" : "Report this post"}
        </button>
      </footer>
      {error && <p role="alert" className="mt-2 text-xs text-dusk-700">{error}</p>}
    </article>
  );
}

function ReactButton({ onClick, busy, done, color, children }: {
  onClick: () => void; busy: boolean; done: boolean;
  color: "bay" | "sage" | "amber2"; children: React.ReactNode;
}) {
  const baseHover = color === "bay" ? "hover:bg-bay-200 hover:text-bay-700"
                  : color === "sage" ? "hover:bg-sage-200 hover:text-sage-700"
                  : "hover:bg-amber2-200 hover:text-amber2-700";
  const doneTone = color === "bay" ? "bg-bay-200 text-bay-700"
                 : color === "sage" ? "bg-sage-200 text-sage-700"
                 : "bg-amber2-200 text-amber2-700";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`px-2.5 py-1 transition-all disabled:opacity-60 disabled:cursor-wait ${done ? doneTone : `surface-muted ${baseHover}`}`}
    >
      {busy ? "…" : done ? `${children} ✓` : children}
    </button>
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
  // Photo attachment (Ring-style). Uploaded to Vercel Blob via /community/upload;
  // null until a photo is chosen. uploadsDisabled flips true on a 503 so we hide
  // the control on deployments without a Blob store.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadsDisabled, setUploadsDisabled] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/community/upload", { method: "POST", body: fd, credentials: "include" });
      if (res.status === 503) { setUploadsDisabled(true); setUploadError("Photo uploads aren’t enabled on this deployment."); return; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setUploadError(json.message || "Upload failed."); return; }
      setImageUrl(json.url as string);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

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
        body: JSON.stringify({ areaSlug, kind, what, where, when, imageUrl: imageUrl ?? undefined }),
      });
      setSuccess("Posted. Thanks for sharing.");
      setWhat(""); setWhere(""); setWhen(""); setImageUrl(null);
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
        No sign-in needed. Describe <strong>what you saw</strong>, <strong>where</strong>, and <strong>when</strong>. Posts are screened before they go live — we block profanity and slurs, threats of violence, street addresses, license plates, phone numbers, named individuals, and descriptions that profile people by appearance. Everything else publishes immediately. See the <Link href="/community-guidelines" className="text-bay-700 hover:underline">Community guidelines</Link>.
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit} aria-describedby={guidance ? "post-guidance" : undefined}>
        <div>
          <label htmlFor="post-kind" className="text-sm text-slate2-700">Category</label>
          <select id="post-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as PostListItem["kind"])} className="mt-1 input">
            <option value="HEADS_UP">Heads-up — something to be aware of</option>
            <option value="AREA_HAZARD">Area hazard — physical / environmental</option>
            <option value="LOST_FOUND">Lost / found — items or pets only</option>
            <option value="SAFETY_NOTICE">Safety notice — general info for the area</option>
          </select>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="post-what" className="text-sm text-slate2-700">What happened (behavior)</label>
            {/* Inline character counter — turns amber/coral as the user
                approaches the 800-char cap the server enforces. Without
                this users could compose a wall of text the moderator
                would then reject. */}
            <span aria-live="polite" aria-atomic="true" className={`text-[11px] tabular-nums ${what.length > 800 ? "text-coral-700 font-medium" : what.length > 700 ? "text-amber2-700" : "text-slate2-500"}`}>
              {what.length} / 800
            </span>
          </div>
          <textarea id="post-what" name="what" required value={what} onChange={(e) => setWhat(e.target.value)} maxLength={800} className="mt-1 input" rows={3} placeholder="e.g. multiple cars had their windows smashed overnight" />
        </div>
        <div>
          <label htmlFor="post-where" className="text-sm text-slate2-700">Where (landmark, not address)</label>
          <input id="post-where" name="where" required value={where} onChange={(e) => setWhere(e.target.value)} className="mt-1 input" placeholder="e.g. parking lot behind the Belmont Park area" />
        </div>
        <div>
          <label htmlFor="post-when" className="text-sm text-slate2-700">When</label>
          <input id="post-when" name="when" required value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 input" placeholder="e.g. Tuesday around 9pm" />
        </div>
        {(aiStatus === "streaming" || aiStatus === "done") && aiFeedback && (
          <div className="surface-muted p-3 text-sm text-slate2-700">
            <div className="text-xs text-slate2-500 mb-1">AI coach (Vercel AI Gateway)</div>
            {aiFeedback}
            {aiStatus === "streaming" && <span className="ml-1 animate-pulse">▍</span>}
          </div>
        )}
        {aiStatus === "disabled" && (
          <p className="text-xs text-slate2-500">AI coaching is off — set <code>GOOGLE_GENERATIVE_AI_API_KEY</code> on Vercel (free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline">aistudio.google.com</a>).</p>
        )}
        {/* Photo attachment (Ring-style). Hidden on deployments without a Blob store. */}
        {!uploadsDisabled && (
          <div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" aria-hidden />
            {imageUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Attached photo preview" className="h-16 w-16 rounded-lg object-cover border border-bay-100" />
                <button type="button" onClick={() => setImageUrl(null)} className="text-xs text-slate2-500 hover:text-coral-700 underline">
                  Remove photo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-sm px-3 py-1.5 rounded-lg border border-bay-200 text-slate2-700 hover:bg-bay-50 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "📷 Add a photo"}
              </button>
            )}
            {uploadError && <p className="mt-1 text-xs text-coral-700">{uploadError}</p>}
          </div>
        )}
        <button type="submit" disabled={busy || uploading} className="btn-primary disabled:opacity-50">
          {busy ? "Posting…" : "Post anonymously"}
        </button>
        {/* Posting-time acceptable-use affirmation — surfaces the rules at the
            point of action and records contractual assent for moderation. */}
        <p className="text-xs text-slate2-500">
          By posting you confirm this is factual to the best of your knowledge and you have the right to share it, and you agree to the{" "}
          <Link href="/community-guidelines" className="text-bay-700 hover:underline">Community guidelines</Link>{" "}and{" "}
          <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>.
        </p>
        {guidance && <p id="post-guidance" role="alert" className="text-sm text-amber2-700">{guidance}</p>}
        {success && <p role="status" aria-live="polite" className="text-sm text-sage-700">{success}</p>}
      </form>
    </section>
  );
}
