"use client";
import { useEffect, useState } from "react";
import { useCity } from "@/lib/use-city";

// Curated cityscape photos served via Unsplash's CDN (the hot-linkable
// `images.unsplash.com` host). Unsplash's License permits this kind of use.
// If any URL 404s the dark gradient overlay still keeps the UI readable, and
// the rotation continues to the next photo.
const PHOTOS: Record<string, string[]> = {
  "san-diego": [
    "https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1582645002527-faa9c5d5060f?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1583425423320-2b59328d4dc5?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1591600196834-83a8d0427e89?auto=format&fit=crop&w=2400&q=70",
  ],
  "los-angeles": [
    "https://images.unsplash.com/photo-1597714026720-8f74c62310ba?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1580655653885-65763b2597d0?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1444723121867-7a241cacace9?auto=format&fit=crop&w=2400&q=70",
  ],
  "san-francisco": [
    "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1521747116042-5a810fda9664?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1499158856793-90b32ecadbcd?auto=format&fit=crop&w=2400&q=70",
    "https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=2400&q=70",
  ],
};

const ROTATE_MS = 5 * 60 * 1000;

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

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden>
      {photos.map((url, i) => (
        <div
          key={`${city.slug}-${i}`}
          className={`absolute inset-0 transition-opacity duration-[2000ms] ${i === idx && !imgError[i] ? "opacity-100" : "opacity-0"}`}
        >
          <img
            src={url}
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            onError={() => setImgError((e) => ({ ...e, [i]: true }))}
            className={`w-full h-full object-cover ${i === idx ? "animate-kenburns" : ""}`}
          />
        </div>
      ))}
      {/* Legibility overlay — light gradient so text remains readable on any photo. */}
      <div className="absolute inset-0 bg-gradient-to-b from-sand-50/55 via-sand-50/75 to-sand-50/92" />
      {/* Accent wash matched to the body's existing radial blooms. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,rgba(30,120,166,0.18),transparent_65%),radial-gradient(ellipse_70%_50%_at_100%_100%,rgba(230,100,60,0.18),transparent_65%)]" />
    </div>
  );
}
