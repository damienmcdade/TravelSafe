import { Router } from "express";
import { z } from "zod";
import { lookupLocation, allKnownAreas } from "../services/geo/lookup.service.js";
import { cityBySlug, normalizeAreaLabel } from "@travelsafe/crime-data/cities";
import { getDiscoveredAreasStale as sdpdStale } from "@travelsafe/crime-data/adapters/sdpd-nibrs";
import { withComputeLimit } from "@travelsafe/crime-data/cache-registry";

export const geoRouter = Router();

geoRouter.get("/lookup", async (req, res, next) => {
  try {
    const q = z.string().min(1).max(200).parse(req.query.q ?? "");
    // v95p15 — optional ?city= so Nominatim scopes by selected city.
    const citySlug = typeof req.query.city === "string" && req.query.city.length > 0
      ? z.string().min(1).max(60).parse(req.query.city)
      : undefined;
    const result = await lookupLocation(q, citySlug);
    if (!result) return res.status(404).json({ error: "no_match" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// v62 sync — was returning a hardcoded SD area list and ignoring the
// `city` param, so Vercel proxies to Railway and got 7 SD areas for
// every city. Brought to parity with apps/web/src/app/api/geo/areas.
// Without ?city= → bare KnownArea[] (legacy back-compat). With
// ?city=<slug> → { areas, stale?, staleMessage? } so the picker can
// render a "warming up" hint when an adapter is serving last-known-
// good data.
geoRouter.get("/areas", async (req, res, next) => {
  try {
    const citySlug = typeof req.query.city === "string" ? req.query.city : null;
    if (citySlug) {
      const city = cityBySlug(citySlug);
      if (!city) return res.json({ areas: [] });
      // v105 — gate discover() through the per-city compute limiter. /geo/areas
      // does a full cold adapter row-load + area aggregation; under a burst of
      // concurrent distinct-city requests (audits/scrapers) the ungated path
      // OOM-crashed the box (502s). Same city-keyed gate the citywide composers
      // use, so a /geo/areas + citywide for the same city share one slot.
      // fix(audit vb-over-fragmentation-2): the picker must use the display-only
      // primary list where a city defines one (VB: ~100 vs 961). The Vercel route
      // already does this, but it PROXIES here first — so this handler also has to
      // honor discoverPrimary or the proxied response re-introduces the 961 list.
      const discovered = await withComputeLimit(citySlug, () => (city.discoverPrimary ?? city.discover)()).catch(() => []);
      // fix(labels-all-caps): a few feeds (Baltimore BPD especially) ship
      // neighborhood names in ALL CAPS. Normalize every label to clean Title
      // Case at this single choke point so the wheel + Watch header + cards
      // read correctly fleet-wide. Idempotent: already-cased labels pass through.
      const areas = discovered.map((a) => ({ ...a, label: normalizeAreaLabel(a.label) }));
      let stale = false;
      let staleMessage: string | undefined;
      if (citySlug === "san-diego" && sdpdStale()) {
        stale = true;
        staleMessage =
          "The San Diego police feed didn't return new data this request, so we're showing the last successful neighborhood pull. Scores and incidents below may be a few minutes behind.";
      }
      return res.json({ areas, stale, staleMessage });
    }
    res.json(allKnownAreas());
  } catch (err) {
    next(err);
  }
});
