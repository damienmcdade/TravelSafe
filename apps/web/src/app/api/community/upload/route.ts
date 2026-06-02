import { NextResponse, type NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { env } from "@/server/lib/env";

// Photo upload for community posts (Ring-Neighbors-style "caught on camera").
// Stores the image in Vercel Blob and returns its public URL, which the post
// composer then attaches as Post.imageUrl. Activates only when a Blob store is
// provisioned (BLOB_READ_WRITE_TOKEN present) — otherwise returns 503 and the
// composer keeps photo upload disabled so text posts are unaffected.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const POST = wrap(async (req: NextRequest) => {
  await requireSession(req);
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "uploads_not_configured", message: "Photo uploads are not enabled on this deployment." },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file", message: "Attach an image file." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "bad_type", message: "Use a JPEG, PNG, WebP, or GIF image." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", message: "Image must be under 8 MB." }, { status: 413 });
  }

  const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const key = `community/${Date.now()}-${Math.round(file.size)}.${ext}`;
  const blob = await put(key, file, {
    access: "public",
    contentType: file.type,
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });
  return NextResponse.json({ url: blob.url }, { status: 201 });
});
