import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { resetPassword } from "@/server/services/auth";

// fix(audit pentest-authn-6): consume a reset token + set a new password. The
// service revokes all existing sessions (tokenVersion bump) and clears any
// brute-force lockout.
const Body = z.object({
  token: z.string().min(10).max(400),
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
});

export const POST = wrap(async (req: NextRequest) => {
  const { token, password } = Body.parse(await req.json());
  await resetPassword(token, password);
  return NextResponse.json({ ok: true });
});
