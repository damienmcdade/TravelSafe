"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useCity } from "@/lib/use-city";
import { PHOTOS } from "@/lib/city-photos";

// Verified Wikimedia Commons photos of the actual cities. Each URL has been
// curl-checked to return HTTP 200 + image/jpeg, and each photo is a
// recognizable landmark (skyline, bridge, observatory, etc.) of the named
// city — no generic stock imagery, no random Lorem Picsum fillers.
//
// All URLs are at 1920×1080 (Wikimedia's standard 1920px thumb width) for
// 1080p backdrop quality.
//
// v93p3 — exported for the /credits page to render per-photo attribution
// (CC-BY-SA 4.0 §3(a)(2)).


// 30-second rotation — keeps the backdrop visibly dynamic without distracting
// the user. Each city carries 8 verified photos, so a full cycle is 4 minutes.
const ROTATE_MS = 30 * 1000;

export function CityBackdrop() {
  const { city } = useCity();
  const photos = PHOTOS[city.slug] ?? [];
  const [idx, setIdx] = useState(0);
  const [imgError, setImgError] = useState<Record<number, boolean>>({});

  // Reset to the first photo whenever the city changes so the user sees the
  // new city's downtown immediately, then resume rotation.
  useEffect(() => { setIdx(0); setImgError({}); }, [city.slug]);

  useEffect(() => {
    if (photos.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % photos.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [photos.length]);

  // fix(audit perf-web-1): only the current photo is visible, but rendering all
  // ~8 as overlapping fullscreen <Image>s made the browser fetch every one (~2MB)
  // on each city — and the backdrop is in the root layout, so it taxed landing
  // LCP. Render only the current photo plus the NEXT one (preloaded for a smooth
  // crossfade); that's at most 2 images in flight instead of the whole set.
  const visible = photos.length <= 1 ? [0] : [idx, (idx + 1) % photos.length];

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      {visible.map((i) => (
        <div
          key={`${city.slug}-${i}`}
          className={`absolute inset-0 transition-opacity duration-[2000ms] ${i === idx && !imgError[i] ? "opacity-100" : "opacity-0"}`}
        >
          {/* Next/Image with fill so it covers the full backdrop pane.
              priority on the first photo so it lands in the LCP budget;
              the rest lazy-load. sizes=100vw because backdrop spans the
              full viewport. unoptimized would skip AVIF conversion —
              we deliberately allow optimization via the remotePatterns
              entry in next.config.ts. */}
          <Image
            src={photos[i]}
            alt=""
            fill
            sizes="100vw"
            priority={i === 0}
            onError={() => setImgError((e) => ({ ...e, [i]: true }))}
            className={`object-cover ${i === idx ? "animate-kenburns" : ""}`}
          />
        </div>
      ))}
      {/* Light legibility overlay — the photo reads clearly while text on top
          stays comfortable to read. No sand-50 wash on the bottom anymore. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-white/45 to-white/65" />
    </div>
  );
}
