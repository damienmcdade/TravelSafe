import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

// v96 — request correlation ID. Attaches a short UUID to every request,
// exposes it on the response Headers as X-Request-Id, and parks it on
// res.locals so morgan can include it in the access log. When a user
// reports "my check-in notification didn't arrive", you can grep the
// logs for that single ID and trace the request through every
// middleware + service.
//
// Honors an incoming X-Request-Id header if the upstream proxy
// (Cloudflare / Railway edge) already set one — keeps trace ID
// stable across the perimeter.

declare module "express-serve-static-core" {
  interface Locals {
    requestId?: string;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = incoming && ID_PATTERN.test(incoming) ? incoming : randomUUID().slice(0, 8);
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
