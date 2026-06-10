import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostStatus, PostKind } from "@/generated/prisma/client";
import { wrap, HttpError } from "@/server/lib/http";
import { optionalSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { preVetPost, POST_RATE_LIMIT_PER_DAY } from "@/server/services/moderation/post-prevet";
import { isSuspended } from "@/server/services/moderation/suspension";
import { publishCommunityEvent } from "@/server/services/community/events";
import { anonPostLimited } from "@/server/lib/rate-limit";
import { ensureAnonymousUser } from "@/server/services/community/anon-user";

// fix(security anon-post-shared-budget): every anonymous post attributes to the
// single shared "anonymous@travelsafe.local" row, so the per-author DB cap below
// is a GLOBAL counter for all anonymous traffic — one source could exhaust it and
// block anonymous posting for everyone (feature-DoS). Gate anonymous posting on a
// per-IP cross-instance limit (anonPostLimited) keyed on the sha256-hashed
// Vercel-attested x-real-ip: a short burst window + a daily cap. Backed by Redis
// when wired, else by an atomic Postgres counter (always reachable from Vercel);
// fails open to the global DB cap below.
const ANON_BURST_LIMIT = 5;          // posts per IP per...
const ANON_BURST_WINDOW_SEC = 600;   // ...10 minutes
const ANON_DAILY_LIMIT = 20;         // posts per IP per day

const Body = z.object({
  areaSlug: z.string().min(1),
  kind: z.nativeEnum(PostKind),
  what:  z.string().min(1).max(800),
  where: z.string().min(1).max(200),
  when:  z.string().min(1).max(200),
  // Optional Vercel Blob URL from /api/community/upload (Ring-style photo).
  imageUrl: z.string().url().startsWith("https://").max(1024).optional(),
});

function compose(input: { what: string; where: string; when: string }) {
  return `What: ${input.what.trim()}\nWhere: ${input.where.trim()}\nWhen: ${input.when.trim()}`;
}

export const dynamic = "force-dynamic";

export const GET = wrap(async (req: NextRequest) => {
  const areaSlug = req.nextUrl.searchParams.get("area") ?? "";
  const citySlug = req.nextUrl.searchParams.get("city") ?? "";
  // Three modes:
  //   ?area=<slug>  → posts in that one neighborhood
  //   ?city=<slug>  → all posts citywide (across every neighborhood in that city's jurisdiction)
  //   neither      → ALL VERIFIED posts globally (admin / debug view only)
  // The citywide path is what (app)/community/page.tsx hits when no
  // neighborhood is picked. Previously the page fell back to
  // city.defaultArea which the adapter doesn't recognize as a real
  // neighborhood; the endpoint returned every VERIFIED post across
  // every city — a Chicago user could see San Diego posts.
  // fix(audit db-post-softdelete-2): every feed query must filter `deletedAt IS
  // NULL` (the schema's @@index([deletedAt]) and the Post model comment both
  // assume this), but these where-clauses only checked status — so a soft-deleted
  // post would still surface. Enforce the documented invariant on all three paths.
  const where = areaSlug
    ? { status: PostStatus.VERIFIED, deletedAt: null, area: { slug: areaSlug } }
    : citySlug
      ? { status: PostStatus.VERIFIED, deletedAt: null, area: { parentSlug: citySlug } }
      : { status: PostStatus.VERIFIED, deletedAt: null };
  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      author: { select: { displayName: true, trustLevel: true } },
      area: true,
      // fix(audit perf-feed-reactions-include): the client only reads
      // _count.reactions, never the rows. Including every reaction row per post
      // is redundant and unbounded — a single viral post would ship thousands of
      // rows on the hottest read path. Keep the aggregate count only.
      // fix(audit C1): do NOT expose `reports` in the public feed — it was an
      // oracle telling an attacker exactly how close each post was to the
      // auto-hide threshold. Moderators see report counts via the queue, not here.
      _count: { select: { comments: true, reactions: true } },
    },
  });
  return NextResponse.json(posts);
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await optionalSession(req);
  let authorId: string;
  if (session) {
    if (await isSuspended(session.uid)) throw new HttpError(403, "user_suspended");
    authorId = session.uid;
  } else {
    // Per-IP throttle BEFORE touching the DB or creating the anon row. In-memory
    // per-instance floor (always on) + distributed cross-instance (when Redis set).
    if (await anonPostLimited(req, {
      burstLimit: ANON_BURST_LIMIT,
      burstWindowSec: ANON_BURST_WINDOW_SEC,
      dailyLimit: ANON_DAILY_LIMIT,
    })) {
      throw new HttpError(429, "rate_limited");
    }
    const anon = await ensureAnonymousUser();
    authorId = anon.id;
  }

  const input = Body.parse(await req.json());
  const area = await prisma.area.findUnique({ where: { slug: input.areaSlug } });
  if (!area) throw new HttpError(404, "unknown_area");

  // Per-author DB rate limit. For signed-in users this is the primary cap; for
  // anonymous traffic it's a global BACKSTOP under the per-IP distributed limit
  // above (it still bounds total anonymous volume if Redis is down).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const todays = await prisma.post.count({ where: { authorId, createdAt: { gte: since } } });
  if (todays >= POST_RATE_LIMIT_PER_DAY) throw new HttpError(429, "daily_post_limit_reached");

  const body = compose(input);
  const vet = preVetPost(body);
  if (vet.block) {
    return NextResponse.json(
      { error: "post_rejected", guidance: vet.inlineGuidance, flags: vet.flags.map((f) => f.kind) },
      { status: 422 },
    );
  }

  // Anonymous posts auto-publish (status = VERIFIED) — per current spec
  // there is no manual verification queue. Posts can still be reported and
  // taken down by moderators.
  const post = await prisma.post.create({
    data: {
      authorId,
      areaId: area.id,
      kind: input.kind,
      body,
      imageUrl: input.imageUrl ?? null,
      status: PostStatus.VERIFIED,
      reviewedAt: new Date(),
      flags: { create: vet.flags.map((f) => ({ kind: f.kind, detail: f.detail })) },
    },
    include: { flags: true, area: true },
  });

  // Push the new post out to any SSE listeners so live feeds update.
  publishCommunityEvent({
    type: "post.verified",
    postId: post.id,
    areaSlug: input.areaSlug,
    kind: post.kind,
    reviewedAt: new Date().toISOString(),
  });

  return NextResponse.json({ post, autoPublished: true }, { status: 201 });
});
