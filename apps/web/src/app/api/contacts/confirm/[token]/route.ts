import { NextResponse, type NextRequest } from "next/server";
import { wrap, HttpError } from "@/server/lib/http";
import { confirmContact } from "@/server/services/contacts";

// fix(audit loc-share-no-token-validation-4): confirm tokens are base64url
// (crypto.randomBytes(24).toString("base64url"), ~32 chars). Reject malformed
// input before the DB lookup.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export const POST = wrap(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "not_found");
  return NextResponse.json(await confirmContact(token));
});
