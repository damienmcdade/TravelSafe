import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "./http";
import { verifySession, type SessionPayload } from "./jwt";

/// Extract + verify the session from an Authorization header. Throws
/// HttpError(401) on missing/invalid token; route handlers catch via wrap().
export function requireSession(req: NextRequest): SessionPayload {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "missing_bearer_token");
  }
  try {
    return verifySession(header.slice("Bearer ".length));
  } catch {
    throw new HttpError(401, "invalid_token");
  }
}

/// Same but returns null instead of throwing — for endpoints that work
/// anonymously but personalize when signed in.
export function optionalSession(req: NextRequest): SessionPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifySession(header.slice("Bearer ".length));
  } catch {
    return null;
  }
}

export function requireModerator(session: SessionPayload, moderatorEmailsCsv: string) {
  const list = moderatorEmailsCsv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.includes(session.email.toLowerCase())) {
    throw new HttpError(403, "moderator_only");
  }
}

export type { SessionPayload };
export { NextResponse };
