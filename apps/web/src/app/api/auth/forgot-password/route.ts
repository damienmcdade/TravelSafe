import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requestPasswordReset } from "@/server/services/auth";

// fix(audit pentest-authn-6): start a password reset. Always returns 200 (even
// for unknown emails) so it can't be used to enumerate accounts; rate-limited in
// middleware to bound reset-email spam.
const Body = z.object({ email: z.string().email().toLowerCase() });

export const POST = wrap(async (req: NextRequest) => {
  const { email } = Body.parse(await req.json());
  await requestPasswordReset(email);
  return NextResponse.json({ ok: true });
});
