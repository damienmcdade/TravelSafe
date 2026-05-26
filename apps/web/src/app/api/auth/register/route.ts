import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { register } from "@/server/services/auth";

const Body = z.object({
  email: z.string().email().toLowerCase(),
  // v92 — min 12 chars (DISA STIG IA-5). 8 was below the FedRAMP baseline.
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
  displayName: z.string().min(1).max(80).optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const { email, password, displayName } = Body.parse(await req.json());
  return NextResponse.json(await register(email, password, displayName), { status: 201 });
});
