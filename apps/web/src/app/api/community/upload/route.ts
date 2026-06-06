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

// fix(audit upload-mime-trust): the allowlist check on `file.type` trusts the
// CLIENT-declared MIME, so a non-image (e.g. text/HTML) with a spoofed
// `image/png` Content-Type was accepted. Stored-XSS is already blocked downstream
// (blob served from a separate origin with `X-Content-Type-Options: nosniff` +
// app CSP `frame-ancestors 'none'`), but we shouldn't store a disguised file at
// all. Sniff the leading magic bytes and (a) reject anything that isn't a real
// image and (b) store using the SNIFFED content type, not the client's claim.
function sniffImageType(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
      head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return "image/png";
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return "image/gif"; // GIF8
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

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
  // Content-based validation — don't trust the client-declared MIME.
  const head = Buffer.from(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (!sniffed || !ALLOWED.has(sniffed)) {
    return NextResponse.json(
      { error: "bad_image", message: "File contents are not a valid JPEG, PNG, WebP, or GIF image." },
      { status: 415 },
    );
  }

  const ext = (sniffed.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const key = `community/${Date.now()}-${Math.round(file.size)}.${ext}`;
  const blob = await put(key, file, {
    access: "public",
    contentType: sniffed, // authoritative type from magic bytes, not file.type
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });
  return NextResponse.json({ url: blob.url }, { status: 201 });
});
