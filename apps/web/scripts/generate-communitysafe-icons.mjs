import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

// ===== CommunitySafe icon — "Sheltering Wing" (photographic master) =====
// Concept 2 from the icon research: a luminous guardian-angel wing spread
// protectively over the downtown-Manhattan skyline at dusk, Empire State glowing
// gold dead-center. The master is a hyper-realistic render (FLUX.1 [schnell],
// Apache-2.0 → commercial-use OK) at icon-master.png. We CENTER-CROP it so the
// focal wings + landmark fill the icon frame (the full wide wingspan reads thin
// when masked to a rounded-rect/circle and shrunk to 48px), tuned visually at
// 512/96/48. Everything fans out from this one master via sharp.
//
// To change the icon: drop a new 1024×1024 master at scripts/icon-master.png and
// rerun `npm run icons:generate --workspace=@travelsafe/web`.

const MASTER = path.join(import.meta.dirname, "icon-master.png");
const CROP = { zoom: 0.84, yShift: -0.03 }; // centered crop, nudged up slightly

const meta = await sharp(MASTER).metadata();
const side = Math.round(meta.width * CROP.zoom);
const box = {
  left: Math.round((meta.width - side) / 2),
  top: Math.max(0, Math.round((meta.height - side) / 2 + meta.height * CROP.yShift)),
  width: side,
  height: side,
};

function cropped() { return sharp(MASTER).extract(box); }

async function png(outPath, size, flatten = true) {
  await mkdir(path.dirname(outPath), { recursive: true });
  let image = cropped().resize(size, size, { fit: "cover" });
  if (flatten) image = image.flatten({ background: "#0A1628" });
  await image.png().toFile(outPath);
}

// favicon.ico — PNG-based (Vista+) multi-size .ico, hand-assembled (no extra dep).
// Next.js App Router auto-serves src/app/favicon.ico at /favicon.ico.
function pngBuffer(size) {
  return cropped().resize(size, size, { fit: "cover" }).flatten({ background: "#0A1628" }).png().toBuffer();
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
    e.writeUInt8(sizes[i], 0); e.writeUInt8(sizes[i], 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length;
  });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.concat([header, entries, ...imgs]));
}

// web / PWA
await png(path.join(root, "public/icons/icon-192.png"), 192);
await png(path.join(root, "public/icons/icon-512.png"), 512);
await png(path.join(root, "public/icons/icon-1024.png"), 1024);
// favicon (App Router auto-serves src/app/favicon.ico at /favicon.ico) + a 180px
// apple-touch-icon served from public/ at a literal path (the App-Router
// /apple-icon metadata convention is overridden by layout.tsx's explicit `icons`
// config, so we reference this explicitly in layout.tsx + manifest.json instead).
await writeFavicon(path.join(root, "src/app/favicon.ico"));
await png(path.join(root, "public/icons/apple-touch-icon.png"), 180);
// iOS (Xcode auto-scales the 1024 marketing icon)
await png(path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024);

// Android launcher (5 densities) + adaptive foreground
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

console.log("CommunitySafe 'Sheltering Wing' (photographic) icon assets regenerated.");
