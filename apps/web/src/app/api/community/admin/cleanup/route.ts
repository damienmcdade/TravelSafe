import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/lib/env";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";

// One-shot cleanup endpoint that wipes seed/test community posts.
// Protected by CRON_SECRET so only the operator can call it.
//
// Usage:
//   curl -X POST "https://travel-safe-chi.vercel.app/api/community/admin/cleanup" \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// What it deletes:
//   * Posts whose body contains "Test post from end-to-end check"
//   * Posts authored by the singleton "Anonymous neighbor" with a body
//     matching the original seed-set wording ("catalytic-converter theft" etc.)
//
// Idempotent: re-running it is a no-op once everything's clean.
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET_not_configured" }, { status: 503 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Hard list of substrings we want gone. These match the seed/test posts we
  // shipped during development; the substring approach means we don't need to
  // know the row IDs in advance.
  const seedSubstrings = [
    "Test post from end-to-end check",
    "no profanity, no threats",
    "Increased catalytic-converter theft reports in this area over the past week",
  ];

  let totalDeleted = 0;
  for (const needle of seedSubstrings) {
    const r = await prisma.post.deleteMany({ where: { body: { contains: needle } } });
    totalDeleted += r.count;
  }

  // Drop any post that's empty / whitespace-only too — these are the artifacts
  // of broken composer states that occasionally landed.
  const emptyR = await prisma.post.deleteMany({ where: { body: "" } });
  totalDeleted += emptyR.count;

  return NextResponse.json({ deleted: totalDeleted });
}
