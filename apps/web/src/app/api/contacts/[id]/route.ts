import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { removeContact } from "@/server/services/contacts";

export const DELETE = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  return NextResponse.json(await removeContact(session.uid, id));
});
