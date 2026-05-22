"use client";
import { useEffect, useState } from "react";
import { useCity } from "@/lib/use-city";

// Curated cityscape photos. Where Unsplash photo IDs were verified to resolve,
// we use the Unsplash CDN; gaps are filled with Lorem Picsum, which always
// returns a real photograph per stable seed string. That guarantees the
// backdrop always renders something — never a blank wall — while still
// rotating between several distinct images per city.
const PHOTOS: Record<string, string[]> = {
  "san-diego": [
    "https://images.unsplash.com/photo-1605649487212-47bdab064df7?auto=format&fit=crop&w=2400&q=70",
    "https://picsum.photos/seed/travelsafe-san-diego-1/2400/1350",
    "https://picsum.photos/seed/travelsafe-san-diego-2/2400/1350",
    "https://picsum.photos/seed/travelsafe-san-diego-3/2400/1350",
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
    "https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?auto=format&fit=crop&w=2400&q=70",
    "https://picsum.photos/seed/travelsafe-san-francisco-1/2400/1350",
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
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
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
      {/* Light legibility overlay — the photo reads clearly while text on top
          stays comfortable to read. No sand-50 wash on the bottom anymore. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-white/45 to-white/65" />
    </div>
  );
}
