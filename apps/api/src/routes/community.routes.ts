import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { PostStatus, ReactionKind } from "../generated/prisma/client.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";
import { preVetPost } from "../services/moderation/post-prevet.js";
import { communityEvents, ensureCommunitySubscriber } from "../services/community/events.js";

export const communityRouter = Router();

// Server-Sent Events stream for newly VERIFIED posts. Public, no auth — the
// payload only carries the post id, area, and timestamps; the client must hit
// /community/posts to render full content (which already filters to VERIFIED).
communityRouter.get("/stream", (req, res) => {
  // Start the per-instance Redis subscriber (idempotent; no-op without
  // REDIS_URL) so events published on other instances reach this stream.
  ensureCommunitySubscriber();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "hello", at: new Date().toISOString() });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  const listener = (evt: unknown) => send(evt);
  communityEvents.on("event", listener);
  req.on("close", () => {
    clearInterval(heartbeat);
    communityEvents.off("event", listener);
    res.end();
  });
});

communityRouter.get("/posts", optionalAuth, async (req, res, next) => {
  try {
    const areaSlug = String(req.query.area ?? "");
    // fix(audit db-post-softdelete-2 parity): exclude soft-deleted posts, matching
    // the canonical web /api/community/posts route. (This Express route is not
    // currently proxied, but the missing filter was a latent leak if it ever is.)
    const where = areaSlug
      ? { status: PostStatus.VERIFIED, deletedAt: null, area: { slug: areaSlug } }
      : { status: PostStatus.VERIFIED, deletedAt: null };
    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        author: { select: { displayName: true } },
        area: true,
        // fix(audit perf-feed-reactions-include): drop the unbounded per-post
        // reaction rows; only the aggregate count is consumed. Mirrors the
        // canonical Vercel route.
        _count: { select: { comments: true, reactions: true, reports: true } },
      },
    });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

communityRouter.get("/posts/mine", requireAuth, async (req, res, next) => {
  try {
    const posts = await prisma.post.findMany({
      where: { authorId: req.session!.uid },
      orderBy: { createdAt: "desc" },
      take: 200, // bound the result set, mirroring the canonical Vercel route
      include: { flags: true, area: true },
    });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

// v96 — DELETED. The E2E audit surfaced that this handler diverged
// hard from the canonical Vercel route at apps/web/src/app/api/
// community/posts (which the SPA actually hits): anon allowed +
// auto-publish vs. auth-required + manual review, with different
// validation shapes. No live client called this Railway handler —
// every grep hit for "community/posts" routes through the Vercel
// wrapper — but leaving it as silently divergent dead code was a
// future-foot-gun if anyone ever wired tryProxy() to it. The 410
// Gone preserves discoverability for any forgotten integration so
// they fail loud instead of getting "weird" behavior.
communityRouter.post("/posts", (_req, res) => {
  res.status(410).json({
    error: "gone",
    message:
      "POST /community/posts on the Railway origin is deprecated. " +
      "All clients should use POST /api/community/posts on communitysafe.app " +
      "(anonymous posting with auto-publish, see web route for current schema).",
  });
});

communityRouter.post("/posts/:id/react", requireAuth, async (req, res, next) => {
  try {
    // v96 — Express 5 types req.params.X as `string | string[]` because
    // path-to-regexp v8 supports wildcard captures. For our single-
    // segment `:id` patterns the runtime always returns a string.
    const postId = req.params.id as string;
    const userId = req.session!.uid;
    const kind = z.nativeEnum(ReactionKind).parse(req.body?.kind);
    await prisma.postReaction.upsert({
      where: { postId_userId_kind: { postId, userId, kind } },
      create: { postId, userId, kind },
      update: {},
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

communityRouter.post("/posts/:id/comment", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const body = z.object({ body: z.string().min(2).max(500) }).parse(req.body);
    const vet = preVetPost(body.body);
    if (vet.block) return res.status(422).json({ error: "comment_rejected", guidance: vet.inlineGuidance });
    const comment = await prisma.postComment.create({
      data: {
        postId: req.params.id as string,
        authorId: req.session!.uid,
        body: body.body,
        status: vet.hold ? PostStatus.PENDING : PostStatus.VERIFIED,
      },
    });
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});
