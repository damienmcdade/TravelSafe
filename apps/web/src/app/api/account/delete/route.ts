import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { deleteAccount } from "@/server/services/account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Require the user to type their email + the literal word "DELETE" as
// confirmation. Prevents an accidental fat-finger from nuking an
// account, and means a stolen session token alone can't trigger
// deletion without also knowing the email.
const Body = z.object({
  confirmEmail: z.string().email(),
  confirmText: z.literal("DELETE"),
});

// POST /api/account/delete — DSAR erasure. Hard-deletes the user row
// and everything FK'd to them. Irreversible. Body must include the
// user's own email and the literal string "DELETE" as a confirmation
// gate.
export const POST = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const { confirmEmail } = Body.parse(await req.json());
  if (confirmEmail.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json(
      { error: "confirmation_mismatch", message: "Email does not match the signed-in account." },
      { status: 400 },
    );
  }
  const result = await deleteAccount(session.uid);
  return NextResponse.json(result);
});
