import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050B1C"/>
      <stop offset="0.55" stop-color="#0A1A38"/>
      <stop offset="0.85" stop-color="#1A2D55"/>
      <stop offset="1" stop-color="#020610"/>
    </linearGradient>
    <radialGradient id="aura" cx="0.5" cy="0.38" r="0.55">
      <stop offset="0" stop-color="#FFE7A8" stop-opacity="0.65"/>
      <stop offset="0.45" stop-color="#FFE7A8" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#FFE7A8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beam" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#FFE9B0" stop-opacity="0.62"/>
      <stop offset="0.75" stop-color="#FFE9B0" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#FFE9B0" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="wingL" x1="1" y1="0" x2="0" y2="0.5">
      <stop offset="0" stop-color="#FBF7E6"/>
      <stop offset="0.65" stop-color="#E8F1F5"/>
      <stop offset="1" stop-color="#88D7E8"/>
    </linearGradient>
    <linearGradient id="wingR" x1="0" y1="0" x2="1" y2="0.5">
      <stop offset="0" stop-color="#FBF7E6"/>
      <stop offset="0.65" stop-color="#E8F1F5"/>
      <stop offset="1" stop-color="#88D7E8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#sky)"/>
  <circle cx="406" cy="118" r="20" fill="#FFE9B0" opacity="0.9"/>
  <circle cx="406" cy="118" r="58" fill="#FFE9B0" opacity="0.12"/>
  <g fill="#F6F2D8" opacity="0.9">
    <circle cx="56" cy="56" r="1.4"/><circle cx="120" cy="92" r="1"/><circle cx="168" cy="40" r="1.6"/>
    <circle cx="216" cy="76" r="1"/><circle cx="296" cy="48" r="1.4"/><circle cx="336" cy="88" r="1"/>
    <circle cx="400" cy="36" r="1.2"/><circle cx="440" cy="80" r="1"/><circle cx="76" cy="138" r="1"/>
    <circle cx="148" cy="156" r="1.2"/><circle cx="380" cy="144" r="1"/><circle cx="452" cy="116" r="1.4"/>
  </g>
  <polygon points="220,200 292,200 360,462 152,462" fill="url(#beam)" opacity="0.72"/>
  <circle cx="256" cy="200" r="120" fill="url(#aura)"/>
  <g fill="#1E2A48" opacity="0.94">
    <rect x="16" y="348" width="28" height="90"/><rect x="44" y="360" width="22" height="78"/><rect x="66" y="330" width="36" height="108"/>
    <rect x="102" y="350" width="26" height="88"/><rect x="128" y="320" width="32" height="118"/><rect x="160" y="340" width="24" height="98"/>
    <rect x="184" y="326" width="30" height="112"/><rect x="218" y="344" width="28" height="94"/><rect x="246" y="318" width="32" height="120"/>
    <rect x="278" y="332" width="26" height="106"/><rect x="304" y="346" width="28" height="92"/><rect x="332" y="318" width="32" height="120"/>
    <rect x="364" y="336" width="24" height="102"/><rect x="388" y="322" width="30" height="116"/><rect x="418" y="348" width="26" height="90"/>
    <rect x="444" y="332" width="32" height="106"/><rect x="476" y="350" width="24" height="88"/>
  </g>
  <g fill="#0F1A33">
    <rect x="22" y="312" width="44" height="168"/><rect x="66" y="296" width="38" height="184"/><rect x="104" y="268" width="50" height="212"/>
    <rect x="154" y="256" width="44" height="224"/><rect x="198" y="240" width="52" height="240"/><rect x="250" y="224" width="56" height="256"/>
    <rect x="306" y="240" width="52" height="240"/><rect x="358" y="256" width="44" height="224"/><rect x="402" y="268" width="50" height="212"/>
    <rect x="452" y="296" width="38" height="184"/><rect x="276" y="208" width="4" height="20"/><rect x="222" y="226" width="3" height="16"/>
    <rect x="328" y="226" width="3" height="16"/>
  </g>
  <g fill="#FFD27F">
    <rect x="30" y="330" width="4" height="4"/><rect x="48" y="356" width="4" height="4"/><rect x="78" y="315" width="4" height="4"/><rect x="118" y="288" width="4" height="4"/>
    <rect x="142" y="336" width="4" height="4"/><rect x="166" y="280" width="4" height="4"/><rect x="188" y="330" width="4" height="4"/><rect x="214" y="262" width="4" height="4"/>
    <rect x="238" y="314" width="4" height="4"/><rect x="270" y="244" width="4" height="4"/><rect x="294" y="326" width="4" height="4"/><rect x="318" y="260" width="4" height="4"/>
    <rect x="348" y="318" width="4" height="4"/><rect x="374" y="280" width="4" height="4"/><rect x="416" y="292" width="4" height="4"/><rect x="462" y="320" width="4" height="4"/>
    <rect x="58" y="390" width="4" height="4"/><rect x="92" y="372" width="4" height="4"/><rect x="130" y="404" width="4" height="4"/><rect x="176" y="386" width="4" height="4"/>
    <rect x="226" y="374" width="4" height="4"/><rect x="282" y="374" width="4" height="4"/><rect x="336" y="386" width="4" height="4"/><rect x="392" y="404" width="4" height="4"/>
    <rect x="438" y="372" width="4" height="4"/><rect x="472" y="390" width="4" height="4"/>
  </g>
  <rect x="0" y="468" width="512" height="44" fill="#020610" opacity="0.9"/>
  <path d="M256 196 Q170 158 92 198 Q138 202 198 218 Q158 220 124 246 Q188 240 226 246 Q198 250 178 270 Q224 256 256 256Z" fill="url(#wingL)"/>
  <path d="M256 196 Q342 158 420 198 Q374 202 314 218 Q354 220 388 246 Q324 240 286 246 Q314 250 334 270 Q288 256 256 256Z" fill="url(#wingR)"/>
  <path d="M256 200 Q200 188 152 196 Q198 200 222 212 Q198 214 178 226 Q226 220 252 224Z" fill="#FBF7E6" opacity="0.55"/>
  <path d="M256 200 Q312 188 360 196 Q314 200 290 212 Q314 214 334 226 Q286 220 260 224Z" fill="#FBF7E6" opacity="0.55"/>
  <circle cx="98" cy="200" r="6" fill="#88D7E8" opacity="0.9"/><circle cx="414" cy="200" r="6" fill="#88D7E8" opacity="0.9"/>
  <path d="M232 196 L280 196 L300 286 L304 308 L208 308 L212 286Z" fill="#FBF7E6"/>
  <path d="M232 196 L240 308M256 196 L256 308M280 196 L272 308" stroke="#8CB6CC" stroke-width="1.5" opacity="0.4" fill="none"/>
  <circle cx="256" cy="172" r="20" fill="#FBF7E6"/>
  <path d="M240 168 Q256 158 272 168 Q272 162 256 156 Q240 162 240 168Z" fill="#8CB6CC" opacity="0.18"/>
  <ellipse cx="256" cy="142" rx="40" ry="11" fill="none" stroke="#FFD27F" stroke-width="4" opacity="0.96"/>
  <ellipse cx="256" cy="142" rx="46" ry="13" fill="none" stroke="#FFD27F" stroke-width="2" opacity="0.55"/>
  <ellipse cx="256" cy="142" rx="34" ry="9" fill="none" stroke="#C99841" stroke-width="1.5" opacity="0.75"/>
  <ellipse cx="246" cy="138" rx="8" ry="2" fill="#FBF7E6" opacity="0.9"/>
  <circle cx="256" cy="220" r="100" fill="none" stroke="#FFE7A8" stroke-width="1" opacity="0.2"/>
</svg>`;

async function png(outPath, size, flatten = true) {
  await mkdir(path.dirname(outPath), { recursive: true });
  let image = sharp(Buffer.from(svg)).resize(size, size, { fit: "cover" });
  if (flatten) image = image.flatten({ background: "#0A1628" });
  await image.png().toFile(outPath);
}

await writeFile(path.join(root, "public/icons/icon.svg"), svg);
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

console.log("CommunitySafe icon assets regenerated.");
