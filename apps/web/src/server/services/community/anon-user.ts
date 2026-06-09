import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/lib/prisma";

// Singleton "Anonymous" user that all anonymous community contributions (posts
// AND comments) attribute to. Avoids making authorId nullable while keeping the
// audit trail intact. Shared so posts and comments resolve the SAME row.
const ANON_EMAIL = "anonymous@travelsafe.local";
const ANON_DISPLAY = "Anonymous neighbor";

export async function ensureAnonymousUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: ANON_EMAIL }, select: { id: true } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email: ANON_EMAIL,
      // Random hash — no one will ever sign in as Anonymous.
      passwordHash: await bcrypt.hash(`anon-${Math.random()}`, 4),
      displayName: ANON_DISPLAY,
    },
    select: { id: true },
  });
}

export const ANONYMOUS_DISPLAY_NAME = ANON_DISPLAY;
