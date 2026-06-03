import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { register } from "@/server/services/auth";
import { env } from "@/server/lib/env";

const Body = z.object({
  email: z.string().email().toLowerCase(),
  // v92 — min 12 chars (DISA STIG IA-5). 8 was below the FedRAMP baseline.
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
  displayName: z.string().min(1).max(80).optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  // fix(audit auth-register-deadend-5): the /register page tells users account
  // creation has been removed, but this endpoint still minted accounts — a
  // claims-vs-code mismatch and an open account-creation surface. Honor the
  // public claim by default; ALLOW_REGISTRATION=true re-opens it. 410 Gone
  // (not 404) so the contract is explicit: the route exists but is retired.
  if (!env.ALLOW_REGISTRATION) {
    return NextResponse.json(
      {
        error: "registration_disabled",
        message:
          "Account creation has been removed. Every device gets an anonymous session automatically — no sign-up needed.",
      },
      { status: 410 },
    );
  }
  const { email, password, displayName } = Body.parse(await req.json());
  return NextResponse.json(await register(email, password, displayName), { status: 201 });
});
