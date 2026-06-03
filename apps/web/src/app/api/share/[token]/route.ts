import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { HttpError } from "@/server/lib/http";
import { resolveSharedView } from "@/server/services/safety/live-share";

// fix(audit loc-share-no-token-validation-4): share tokens are base64url
// (crypto.randomBytes(20).toString("base64url"), ~27 chars). Reject anything that
// can't be a real token BEFORE the DB lookup — cheap input hygiene that turns
// junk/probe paths into a fast 404 instead of a wasted query, and bounds the
// param so it can't be abused as an oversized lookup key.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export const GET = wrap(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "not_found");
  return NextResponse.json(await resolveSharedView(token));
});
