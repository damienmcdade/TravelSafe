import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { confirmContact } from "@/server/services/contacts";

export const POST = wrap(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  return NextResponse.json(await confirmContact(token));
});
