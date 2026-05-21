import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { PostStatus, PostKind, ReactionKind } from "@prisma/client";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";
import { HttpError } from "../middleware/error.js";
import { preVetPost, POST_RATE_LIMIT_PER_DAY } from "../services/moderation/post-prevet.js";
import { isSuspended } from "../services/moderation/suspension.service.js";
import { communityEvents } from "../services/community/events.js";

export const communityRouter = Router();

// Server-Sent Events stream for newly VERIFIED posts. Public, no auth — the
// payload only carries the post id, area, and timestamps; the client must hit
// /community/posts to render full content (which already filters to VERIFIED).
communityRouter.get("/stream", (req, res) => {
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

// Structured composer fields — per the anti-pattern guardrail spec, the
// composer steers authors to describe BEHAVIOR + PLACE + TIME instead of a
// free-text box that invites "suspicious person who looked..." narratives.
const newPostBody = z.object({
  areaSlug: z.string().min(1),
  kind: z.nativeEnum(PostKind),
  what:  z.string().min(15).max(500).describe("What happened — the behavior you observed"),
  where: z.string().min(3).max(120).describe("Where in the area — a landmark, NOT a street address"),
  when:  z.string().min(3).max(120).describe("Roughly when — e.g. 'Tuesday around 9pm'"),
  acceptedDefamationNotice: z.literal(true, {
    errorMap: () => ({ message: "Must acknowledge the truthfulness / defamation notice before posting" }),
  }),
  acceptedText: z.string().min(10),
});

function composeBody(input: { what: string; where: string; when: string }) {
  return `What: ${input.what.trim()}\nWhere: ${input.where.trim()}\nWhen: ${input.when.trim()}`;
}

communityRouter.get("/posts", optionalAuth, async (req, res, next) => {
  try {
    const areaSlug = String(req.query.area ?? "");
    const where = areaSlug
      ? { status: PostStatus.VERIFIED, area: { slug: areaSlug } }
      : { status: PostStatus.VERIFIED };
    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        author: { select: { id: true, displayName: true } },
        area: true,
        reactions: true,
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
      include: { flags: true, area: true },
    });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

communityRouter.post("/posts", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const userId = req.session!.uid;
    if (await isSuspended(userId)) throw new HttpError(403, "user_suspended");

    const input = newPostBody.parse(req.body);

    const area = await prisma.area.findUnique({ where: { slug: input.areaSlug } });
    if (!area) throw new HttpError(404, "unknown_area");

    // Daily rate limit
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todays = await prisma.post.count({ where: { authorId: userId, createdAt: { gte: since } } });
    if (todays >= POST_RATE_LIMIT_PER_DAY) throw new HttpError(429, "daily_post_limit_reached");

    const body = composeBody(input);
    const vet = preVetPost(body);
    if (vet.block) {
      return res.status(422).json({
        error: "post_rejected",
        guidance: vet.inlineGuidance,
        flags: vet.flags.map((f) => f.kind),
      });
    }

    const post = await prisma.post.create({
      data: {
        authorId: userId,
        areaId: area.id,
        kind: input.kind,
        body,
        status: PostStatus.PENDING,
        flags: { create: vet.flags.map((f) => ({ kind: f.kind, detail: f.detail })) },
        acknowledgement: {
          create: { userId, acceptedText: input.acceptedText },
        },
      },
      include: { flags: true },
    });
    res.status(201).json({ post, heldForReview: vet.hold });
  } catch (err) {
    next(err);
  }
});

communityRouter.post("/posts/:id/react", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session!.uid;
    const kind = z.nativeEnum(ReactionKind).parse(req.body?.kind);
    await prisma.postReaction.upsert({
      where: { postId_userId_kind: { postId: req.params.id, userId, kind } },
      create: { postId: req.params.id, userId, kind },
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
        postId: req.params.id,
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
