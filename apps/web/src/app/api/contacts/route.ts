import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { addContact, listContacts } from "@/server/services/contacts";

const NewContact = z.object({
  label: z.string().min(1).max(40),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(7).max(20).optional().nullable(),
});

export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  return NextResponse.json(await listContacts(session.uid));
});

export const POST = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const input = NewContact.parse(await req.json());
  return NextResponse.json(await addContact(session.uid, input), { status: 201 });
});
