import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { login } from "@/server/services/auth";

const Body = z.object({
  email: z.string().email().toLowerCase(),
  // fix(audit auth-password-policy-mismatch-6): this min(8) is a deliberate
  // SANITY floor, NOT the password policy. The 12-char policy is enforced where
  // a password is SET (register + reset). Login only AUTHENTICATES an existing
  // hash, so raising this to 12 would lock out any account created before the
  // policy was tightened. The floor just rejects obviously-empty/garbage input
  // before the (expensive) bcrypt compare.
  password: z.string().min(8).max(200),
});

export const POST = wrap(async (req: NextRequest) => {
  const { email, password } = Body.parse(await req.json());
  return NextResponse.json(await login(email, password));
});
