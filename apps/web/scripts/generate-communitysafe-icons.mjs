import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

// ===== CommunitySafe icon — "Sheltering Wing" (concept 2) =====
// A single luminous guardian-angel wing arcing protectively over a minimal
// downtown-Manhattan skyline at dusk (Empire State + a terraced crown), warm
// gilded street glow below. The wing is the focal element that survives at 48px;
// the skyline is a supporting silhouette baseline. Secular (no halo/face), in the
// category's unclaimed "wing" white space (competitors are flat blue shields/pins/
// houses). Palette extends the brand: midnight-dusk navy field, white→cyan wing,
// gold windows, gilded base. Built parametrically so the feathering is tunable.

const D = (n) => n.toFixed(1);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const bez = (t, p0, p1, p2) => { const u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; };

// One feather: root -> curved blade -> curled tip -> back (angDeg: 90 = down).
function feather(rx, ry, angDeg, len, wid, curlDeg) {
  const a = (angDeg * Math.PI) / 180, a2 = ((angDeg + curlDeg) * Math.PI) / 180;
  const tx = rx + len * Math.cos(a2), ty = ry + len * Math.sin(a2);
  const px = -Math.sin(a), py = Math.cos(a);
  const mx = rx + len * 0.5 * Math.cos(a), my = ry + len * 0.5 * Math.sin(a);
  return `M${D(rx)} ${D(ry)} Q${D(mx + px * wid)} ${D(my + py * wid)} ${D(tx)} ${D(ty)} Q${D(mx - px * wid)} ${D(my - py * wid)} ${D(rx)} ${D(ry)} Z`;
}

// Leading-edge arc (wing "arm"): shoulder right -> arches up over the city -> wingtip left.
const S = [398, 214], C = [246, 110], T = [92, 168];
function buildWing(rows) {
  let out = "";
  for (const r of rows) {
    const { n, l0, l1, w, a0, a1, curl, fill, op, t0 = 0, t1 = 1 } = r;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1);
      const [rx, ry] = bez(lerp(t0, t1, u), S, C, T);
      const len = lerp(l0, l1, smooth(u));
      out += `<path d="${feather(rx, ry, lerp(a0, a1, u), len, len * w, curl)}" fill="${fill}" fill-opacity="${op}" stroke="#4E93AD" stroke-width="1.1" stroke-opacity="0.4"/>`;
    }
  }
  return out;
}
const wing =
  buildWing([{ n: 12, l0: 96, l1: 250, w: 0.13, a0: 104, a1: 158, curl: -20, fill: "url(#wing)", op: 1 }]) +
  buildWing([{ n: 9, l0: 66, l1: 150, w: 0.16, a0: 110, a1: 150, curl: -16, fill: "url(#wing2)", op: 1, t0: 0.05, t1: 0.92 }]) +
  buildWing([{ n: 6, l0: 48, l1: 92, w: 0.2, a0: 116, a1: 142, curl: -12, fill: "#FFFEF8", op: 0.97, t0: 0.1, t1: 0.8 }]);
const rim = `<path d="M${D(S[0])} ${D(S[1])} Q${D(C[0])} ${D(C[1])} ${D(T[0])} ${D(T[1])}" fill="none" stroke="#FFFEF8" stroke-width="5" stroke-opacity="0.9" stroke-linecap="round"/>`;
const knuckle = `<circle cx="${D(S[0])}" cy="${D(S[1])}" r="9" fill="url(#wing2)"/>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050B1C"/><stop offset="0.5" stop-color="#0B1C3C"/>
      <stop offset="0.86" stop-color="#1B2F58"/><stop offset="1" stop-color="#04091A"/>
    </linearGradient>
    <radialGradient id="aura" cx="0.42" cy="0.34" r="0.6">
      <stop offset="0" stop-color="#FFE7A8" stop-opacity="0.4"/>
      <stop offset="0.5" stop-color="#9FD8E8" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#FFE7A8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wing" x1="0.95" y1="0.05" x2="0.1" y2="0.9">
      <stop offset="0" stop-color="#FFFDF4"/><stop offset="0.45" stop-color="#E8F2F7"/>
      <stop offset="0.78" stop-color="#A2DBEB"/><stop offset="1" stop-color="#5FBFD8"/>
    </linearGradient>
    <linearGradient id="wing2" x1="0.9" y1="0.05" x2="0.2" y2="0.95">
      <stop offset="0" stop-color="#FFFEF8"/><stop offset="0.6" stop-color="#DBEDF4"/><stop offset="1" stop-color="#88D2E5"/>
    </linearGradient>
    <linearGradient id="bld" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#17263F"/><stop offset="1" stop-color="#060E1E"/>
    </linearGradient>
    <linearGradient id="gild" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFE9B0" stop-opacity="0.8"/>
      <stop offset="0.5" stop-color="#D6A84F" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#0A1628" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="512" height="512" rx="96" fill="url(#sky)"/>
  <g fill="#EAF2F6" opacity="0.85">
    <circle cx="64" cy="58" r="1.4"/><circle cx="150" cy="40" r="1"/><circle cx="318" cy="38" r="1.3"/>
    <circle cx="430" cy="64" r="1.2"/><circle cx="466" cy="118" r="1"/><circle cx="40" cy="140" r="1"/>
    <circle cx="232" cy="50" r="0.9"/><circle cx="372" cy="46" r="1"/>
  </g>
  <ellipse cx="226" cy="196" rx="216" ry="166" fill="url(#aura)"/>

  <g fill="url(#bld)">
    <rect x="18" y="392" width="42" height="88"/><rect x="60" y="372" width="32" height="108"/>
    <rect x="92" y="386" width="26" height="94"/><rect x="332" y="386" width="26" height="94"/>
    <rect x="358" y="372" width="36" height="108"/><rect x="394" y="392" width="34" height="88"/>
    <rect x="428" y="404" width="46" height="76"/>
  </g>
  <g>
    <rect x="150" y="322" width="42" height="158" fill="url(#bld)"/>
    <path d="M171 280 L150 322 L192 322 Z" fill="url(#bld)"/>
    <path d="M171 290 L162 322 M171 290 L180 322 M171 300 L156 322 M171 300 L186 322" stroke="#3A567C" stroke-width="1.2" opacity="0.5"/>
    <rect x="169" y="258" width="4" height="24" fill="#9FD8E8"/>
  </g>
  <g>
    <rect x="228" y="288" width="56" height="192" fill="url(#bld)"/>
    <rect x="238" y="266" width="36" height="24" fill="url(#bld)"/><rect x="249" y="250" width="14" height="18" fill="url(#bld)"/>
    <rect x="254" y="208" width="5" height="44" fill="#CFE3EC"/><circle cx="256" cy="208" r="3" fill="#FFE9B0"/>
  </g>
  <g fill="#FFD27F">
    <rect x="28" y="404" width="4" height="4"/><rect x="46" y="428" width="4" height="4"/><rect x="70" y="388" width="4" height="4"/>
    <rect x="100" y="400" width="4" height="4"/><rect x="244" y="312" width="4" height="4"/><rect x="266" y="340" width="4" height="4"/>
    <rect x="250" y="372" width="4" height="4"/><rect x="340" y="404" width="4" height="4"/><rect x="368" y="388" width="4" height="4"/>
    <rect x="404" y="408" width="4" height="4"/><rect x="440" y="420" width="4" height="4"/><rect x="162" y="350" width="4" height="4"/>
  </g>
  <rect x="0" y="456" width="512" height="56" fill="url(#gild)"/>
  <rect x="0" y="498" width="512" height="14" fill="#04091A" opacity="0.7"/>

  <g transform="rotate(-3 250 220)">${wing}${rim}${knuckle}</g>
</svg>`;

async function png(outPath, size, flatten = true) {
  await mkdir(path.dirname(outPath), { recursive: true });
  let image = sharp(Buffer.from(svg)).resize(size, size, { fit: "cover" });
  if (flatten) image = image.flatten({ background: "#0A1628" });
  await image.png().toFile(outPath);
}

// favicon.ico — a PNG-based (Vista+) multi-size .ico assembled by hand so we
// don't pull a new dependency. Next.js App Router auto-serves src/app/favicon.ico
// at /favicon.ico (fixes the bare /favicon.ico 404; the <link> metadata in
// layout.tsx already covers modern browsers, this covers the legacy request).
async function pngBuffer(size) {
  return sharp(Buffer.from(svg)).resize(size, size, { fit: "cover" }).flatten({ background: "#0A1628" }).png().toBuffer();
}
async function writeFavicon(outPath) {
  const sizes = [16, 32, 48];
  const imgs = await Promise.all(sizes.map(pngBuffer));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const entries = Buffer.alloc(16 * sizes.length);
  let offset = 6 + entries.length;
  imgs.forEach((buf, i) => {
    const e = entries.subarray(i * 16, i * 16 + 16);
    e.writeUInt8(sizes[i], 0); e.writeUInt8(sizes[i], 1); // w,h (≤255 fit in a byte)
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);        // planes, bit depth
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length;
  });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.concat([header, entries, ...imgs]));
}

await writeFile(path.join(root, "public/icons/icon.svg"), svg);
await writeFavicon(path.join(root, "src/app/favicon.ico"));
await png(path.join(root, "public/icons/icon-192.png"), 192);
await png(path.join(root, "public/icons/icon-512.png"), 512);
await png(path.join(root, "public/icons/icon-1024.png"), 1024);
await png(path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024);

const android = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];
for (const [dir, size] of android) {
  const base = path.join(root, "android/app/src/main/res", dir);
  await png(path.join(base, "ic_launcher.png"), size);
  await png(path.join(base, "ic_launcher_round.png"), size);
  await png(path.join(base, "ic_launcher_foreground.png"), size, false);
}

console.log("CommunitySafe 'Sheltering Wing' icon assets regenerated.");
