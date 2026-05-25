// v65 — CommunitySafe icon system. Angel above the city: silhouetted
// skyscrapers under a hovering guardian figure with glowing wings + a
// subtle halo. Optimized for 16px → 1024px scaling — at the smallest
// sizes only the silhouette + halo glow read; at full size the
// individual windows + wing feathers come through.
//
// Three variants:
//   AppIcon(theme="dark") — default, deep-navy background, gold/cyan glow
//   AppIcon(theme="light") — pale-sky background, dimmer accents
//   AppIconSimple — favicon-safe minimal version (no windows, simpler wings)
//
// Color palette (also documented in PALETTE for downstream tooling):
//   night-deep    #0A1628  — primary background
//   night-mid     #122440  — gradient top, secondary city silhouettes
//   city-silh     #1A2640  — main building silhouettes
//   window-gold   #FFD27F  — sparse window lights
//   angel-white   #FFFFFF  — angel body + halo core
//   wing-cyan     #88D7E8  — wing glow
//   halo-gold     #FFD27F  — halo ring
//   day-sky       #E8F4FA  — light-theme background
//   day-city      #5D6A78  — light-theme silhouettes
//
// Usage in JSX:
//   <AppIcon className="w-8 h-8" />
//   <AppIconSimple width={48} height={48} />
// Usage for raster generation (Next ImageResponse, build-time PNG):
//   import the SVG strings (ICON_SVG_DARK / ICON_SVG_SIMPLE) and pipe
//   into your renderer.

export const PALETTE = {
  nightDeep: "#0A1628",
  nightMid: "#122440",
  citySilh: "#1A2640",
  windowGold: "#FFD27F",
  angelWhite: "#FFFFFF",
  wingCyan: "#88D7E8",
  haloGold: "#FFD27F",
  daySky: "#E8F4FA",
  dayCity: "#5D6A78",
} as const;

interface Props {
  theme?: "dark" | "light";
  className?: string;
  width?: number | string;
  height?: number | string;
  title?: string;
}

/// Full-detail icon. Use for app launcher (1024×1024), OG image,
/// hero header. Renders cleanly down to ~64px.
export function AppIcon({ theme = "dark", className, width, height, title = "CommunitySafe" }: Props) {
  const isDark = theme === "dark";
  const bg = isDark ? PALETTE.nightDeep : PALETTE.daySky;
  const bgTop = isDark ? PALETTE.nightMid : "#FFFFFF";
  const city = isDark ? PALETTE.citySilh : PALETTE.dayCity;
  const windowFill = isDark ? PALETTE.windowGold : "#F5C84E";
  const angelFill = isDark ? PALETTE.angelWhite : "#FFFFFF";
  const wingGlow = isDark ? PALETTE.wingCyan : "#5BA8C9";
  const halo = PALETTE.haloGold;

  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      width={width ?? "100%"}
      height={height ?? "100%"}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id="cs-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bgTop} />
          <stop offset="1" stopColor={bg} />
        </linearGradient>
        <radialGradient id="cs-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={halo} stopOpacity="0.8" />
          <stop offset="1" stopColor={halo} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cs-wing-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={wingGlow} stopOpacity="0.5" />
          <stop offset="1" stopColor={wingGlow} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Rounded background — iOS-safe corner (no clip needed; iOS
          handles its own mask, Android adaptive icons use the
          foreground+background layer system) */}
      <rect width="512" height="512" rx="96" fill="url(#cs-bg)" />

      {/* Wing glow halo (renders behind angel body) */}
      <circle cx="256" cy="220" r="180" fill="url(#cs-wing-glow)" />

      {/* City silhouette band — bottom third of the icon. Building
          heights mirror around the angel for visual symmetry. */}
      <g fill={city}>
        <rect x="32"  y="360" width="56" height="120" />
        <rect x="88"  y="320" width="48" height="160" />
        <rect x="136" y="290" width="64" height="190" />
        <rect x="200" y="270" width="56" height="210" />
        <rect x="256" y="270" width="56" height="210" />
        <rect x="312" y="290" width="64" height="190" />
        <rect x="376" y="320" width="48" height="160" />
        <rect x="424" y="360" width="56" height="120" />
      </g>
      {/* Window pinpricks — sparse warm-gold dots scattered across the
          city silhouette. Hand-placed; keep odd numbers so the eye
          doesn't read a grid. */}
      <g fill={windowFill} opacity={isDark ? 1 : 0.85}>
        {/* far-left buildings */}
        <rect x="44"  y="390" width="6" height="6" />
        <rect x="68"  y="420" width="6" height="6" />
        <rect x="58"  y="450" width="6" height="6" />
        <rect x="100" y="340" width="6" height="6" />
        <rect x="118" y="380" width="6" height="6" />
        <rect x="100" y="430" width="6" height="6" />
        <rect x="148" y="310" width="6" height="6" />
        <rect x="174" y="340" width="6" height="6" />
        <rect x="158" y="390" width="6" height="6" />
        <rect x="180" y="430" width="6" height="6" />
        {/* center towers (under angel) */}
        <rect x="218" y="295" width="6" height="6" />
        <rect x="240" y="330" width="6" height="6" />
        <rect x="220" y="370" width="6" height="6" />
        <rect x="240" y="410" width="6" height="6" />
        <rect x="220" y="450" width="6" height="6" />
        <rect x="276" y="295" width="6" height="6" />
        <rect x="298" y="330" width="6" height="6" />
        <rect x="276" y="370" width="6" height="6" />
        <rect x="298" y="410" width="6" height="6" />
        <rect x="276" y="450" width="6" height="6" />
        {/* right-side mirror */}
        <rect x="324" y="310" width="6" height="6" />
        <rect x="346" y="340" width="6" height="6" />
        <rect x="358" y="390" width="6" height="6" />
        <rect x="332" y="430" width="6" height="6" />
        <rect x="388" y="340" width="6" height="6" />
        <rect x="406" y="380" width="6" height="6" />
        <rect x="388" y="430" width="6" height="6" />
        <rect x="438" y="390" width="6" height="6" />
        <rect x="462" y="420" width="6" height="6" />
        <rect x="450" y="450" width="6" height="6" />
      </g>

      {/* WINGS — two arcs sweeping outward from angel's shoulders.
          Drawn as filled paths so they read at small sizes (line-only
          wings vanish at 16px). */}
      <g fill={angelFill} opacity="0.95">
        {/* Left wing */}
        <path d="M256 200 Q 130 170 100 250 Q 150 220 220 240 Q 230 220 256 220 Z" />
        {/* Right wing (mirrored) */}
        <path d="M256 200 Q 382 170 412 250 Q 362 220 292 240 Q 282 220 256 220 Z" />
      </g>
      {/* Wing-tip glow accents */}
      <g fill={wingGlow} opacity="0.65">
        <circle cx="100" cy="248" r="14" />
        <circle cx="412" cy="248" r="14" />
      </g>

      {/* ANGEL BODY — minimalist robed figure. Head on top, robed
          trapezoid body. Symmetric so flipping the icon doesn't break
          composition. */}
      <g fill={angelFill}>
        {/* Halo ring above head */}
        <circle cx="256" cy="150" r="28" fill="none" stroke={halo} strokeWidth="6" opacity="0.85" />
        {/* Head */}
        <circle cx="256" cy="170" r="22" />
        {/* Robed body */}
        <path d="M232 192 L280 192 L296 280 L216 280 Z" />
      </g>
      {/* Halo glow */}
      <circle cx="256" cy="150" r="40" fill="url(#cs-halo)" />
    </svg>
  );
}

/// Favicon-safe simplified version. No windows, simpler wings, no
/// halo glow. Reads at 16×16 down to 32×32 favicon slots.
export function AppIconSimple({ theme = "dark", className, width, height, title = "CommunitySafe" }: Props) {
  const isDark = theme === "dark";
  const bg = isDark ? PALETTE.nightDeep : PALETTE.daySky;
  const city = isDark ? PALETTE.citySilh : PALETTE.dayCity;
  const angelFill = isDark ? PALETTE.angelWhite : "#1A2640";
  const halo = PALETTE.haloGold;
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      width={width ?? "100%"}
      height={height ?? "100%"}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <rect width="64" height="64" rx="12" fill={bg} />
      {/* City silhouette — three blocks (left, center, right) */}
      <g fill={city}>
        <rect x="6"  y="44" width="14" height="18" />
        <rect x="20" y="38" width="24" height="24" />
        <rect x="44" y="44" width="14" height="18" />
      </g>
      {/* Wings — single curve each side */}
      <g fill={angelFill}>
        <path d="M32 24 Q 14 20 12 30 Q 20 26 30 28 Z" />
        <path d="M32 24 Q 50 20 52 30 Q 44 26 34 28 Z" />
      </g>
      {/* Halo */}
      <circle cx="32" cy="18" r="4" fill="none" stroke={halo} strokeWidth="1.5" />
      {/* Head */}
      <circle cx="32" cy="22" r="3" fill={angelFill} />
      {/* Body */}
      <path d="M28 25 L36 25 L38 34 L26 34 Z" fill={angelFill} />
    </svg>
  );
}

/// Raw SVG strings for build-time rasterization (e.g. ImageMagick
/// pipeline that writes /public/icons/icon-192.png etc.). Mirror of
/// the React components above. Keeping them in sync manually — these
/// strings get rasterized once at build time; the React components
/// power the live SVG renders.
export const ICON_SVG_DARK = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${PALETTE.nightMid}"/>
      <stop offset="1" stop-color="${PALETTE.nightDeep}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${PALETTE.haloGold}" stop-opacity="0.8"/>
      <stop offset="1" stop-color="${PALETTE.haloGold}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wglow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${PALETTE.wingCyan}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${PALETTE.wingCyan}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <circle cx="256" cy="220" r="180" fill="url(#wglow)"/>
  <g fill="${PALETTE.citySilh}">
    <rect x="32" y="360" width="56" height="120"/>
    <rect x="88" y="320" width="48" height="160"/>
    <rect x="136" y="290" width="64" height="190"/>
    <rect x="200" y="270" width="56" height="210"/>
    <rect x="256" y="270" width="56" height="210"/>
    <rect x="312" y="290" width="64" height="190"/>
    <rect x="376" y="320" width="48" height="160"/>
    <rect x="424" y="360" width="56" height="120"/>
  </g>
  <g fill="${PALETTE.windowGold}">
    <rect x="44" y="390" width="6" height="6"/><rect x="68" y="420" width="6" height="6"/>
    <rect x="58" y="450" width="6" height="6"/><rect x="100" y="340" width="6" height="6"/>
    <rect x="118" y="380" width="6" height="6"/><rect x="100" y="430" width="6" height="6"/>
    <rect x="148" y="310" width="6" height="6"/><rect x="174" y="340" width="6" height="6"/>
    <rect x="158" y="390" width="6" height="6"/><rect x="180" y="430" width="6" height="6"/>
    <rect x="218" y="295" width="6" height="6"/><rect x="240" y="330" width="6" height="6"/>
    <rect x="220" y="370" width="6" height="6"/><rect x="240" y="410" width="6" height="6"/>
    <rect x="220" y="450" width="6" height="6"/><rect x="276" y="295" width="6" height="6"/>
    <rect x="298" y="330" width="6" height="6"/><rect x="276" y="370" width="6" height="6"/>
    <rect x="298" y="410" width="6" height="6"/><rect x="276" y="450" width="6" height="6"/>
    <rect x="324" y="310" width="6" height="6"/><rect x="346" y="340" width="6" height="6"/>
    <rect x="358" y="390" width="6" height="6"/><rect x="332" y="430" width="6" height="6"/>
    <rect x="388" y="340" width="6" height="6"/><rect x="406" y="380" width="6" height="6"/>
    <rect x="388" y="430" width="6" height="6"/><rect x="438" y="390" width="6" height="6"/>
    <rect x="462" y="420" width="6" height="6"/><rect x="450" y="450" width="6" height="6"/>
  </g>
  <g fill="${PALETTE.angelWhite}" opacity="0.95">
    <path d="M256 200 Q 130 170 100 250 Q 150 220 220 240 Q 230 220 256 220 Z"/>
    <path d="M256 200 Q 382 170 412 250 Q 362 220 292 240 Q 282 220 256 220 Z"/>
  </g>
  <g fill="${PALETTE.wingCyan}" opacity="0.65">
    <circle cx="100" cy="248" r="14"/>
    <circle cx="412" cy="248" r="14"/>
  </g>
  <g fill="${PALETTE.angelWhite}">
    <circle cx="256" cy="150" r="28" fill="none" stroke="${PALETTE.haloGold}" stroke-width="6" opacity="0.85"/>
    <circle cx="256" cy="170" r="22"/>
    <path d="M232 192 L280 192 L296 280 L216 280 Z"/>
  </g>
  <circle cx="256" cy="150" r="40" fill="url(#halo)"/>
</svg>`;

export const ICON_SVG_SIMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="12" fill="${PALETTE.nightDeep}"/>
  <g fill="${PALETTE.citySilh}">
    <rect x="6" y="44" width="14" height="18"/>
    <rect x="20" y="38" width="24" height="24"/>
    <rect x="44" y="44" width="14" height="18"/>
  </g>
  <g fill="${PALETTE.angelWhite}">
    <path d="M32 24 Q 14 20 12 30 Q 20 26 30 28 Z"/>
    <path d="M32 24 Q 50 20 52 30 Q 44 26 34 28 Z"/>
  </g>
  <circle cx="32" cy="18" r="4" fill="none" stroke="${PALETTE.haloGold}" stroke-width="1.5"/>
  <circle cx="32" cy="22" r="3" fill="${PALETTE.angelWhite}"/>
  <path d="M28 25 L36 25 L38 34 L26 34 Z" fill="${PALETTE.angelWhite}"/>
</svg>`;
