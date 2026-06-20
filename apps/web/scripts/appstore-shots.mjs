// App Store screenshots for the CommunitySafe iOS app at 6.9" (1290 x 2796).
// Renders the LIVE site as it appears inside the native iOS WebView shell:
// mobile viewport, ad consent set to "reject" (no ad clutter), a default city
// preselected so every screen shows real data.
import puppeteer from "puppeteer";
import { mkdir } from "node:fs/promises";

const OUT = process.env.SHOT_OUT || `${process.env.HOME}/Desktop/CommunitySafe-Screenshots/iPhone-6.5`;
const BASE = process.env.SHOT_URL || "https://communitysafe.app";
const CITY = process.env.SHOT_CITY || "new-york";

await mkdir(OUT, { recursive: true });

const SCREENS = [
  { file: "01-home.png", path: "/", settle: 3500 },
  { file: "02-city-awareness.png", path: "/city", settle: 4500 },
  { file: "03-neighborhood.png", path: "/neighborhood", settle: 4500 },
  { file: "04-map.png", path: "/map", settle: 5000 },
  { file: "05-trends.png", path: "/trends", settle: 4000 },
  { file: "06-pathfinder.png", path: "/overwatch", settle: 4000 },
  { file: "07-safety-sos.png", path: "/safety", settle: 3500 },
  { file: "08-connections.png", path: "/community", settle: 3500 },
  { file: "09-watch.png", path: "/watch", settle: 3500 },
  { file: "10-coverage.png", path: "/coverage", settle: 3500 },
];

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setUserAgent(
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
);
// 414 x 896 CSS px @ 3x = 1242 x 2688 device px (App Store Connect 6.5" slot).
await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 3 });

// Seed localStorage before any app script runs: pick a city, suppress ads.
await page.evaluateOnNewDocument((city) => {
  try {
    localStorage.setItem("travelsafe.city.v1", city);
    localStorage.setItem("cs.consent.v1", "reject");
    localStorage.setItem("cs.age.v1", "ok");
  } catch {}
}, CITY);

async function dismissOverlays() {
  await page.evaluate(() => {
    // best-effort: hide any lingering cookie/consent banner
    document.querySelectorAll('[class*="consent"],[class*="cookie"],[id*="consent"],[id*="cookie"]').forEach((el) => {
      const t = (el.textContent || "").toLowerCase();
      if (t.includes("cookie") || t.includes("consent") || t.includes("ad")) {
        (el).style.display = "none";
      }
    });
  });
}

for (const s of SCREENS) {
  try {
    await page.goto(BASE + s.path, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, s.settle));
    await dismissOverlays();
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/${s.file}` });
    console.log("saved", s.file);
  } catch (e) {
    console.log("FAILED", s.file, String(e).slice(0, 120));
  }
}

await browser.close();
console.log("Done. Output:", OUT);
