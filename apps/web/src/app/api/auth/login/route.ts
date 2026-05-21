import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { login } from "@/server/services/auth";

const Body = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
});

export const POST = wrap(async (req: NextRequest) => {
  const { email, password } = Body.parse(await req.json());
  return NextResponse.json(await login(email, password));
});
