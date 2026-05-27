import { Router } from "express";
import { z } from "zod";
import { lookupLocation, allKnownAreas } from "../services/geo/lookup.service.js";
import { cityBySlug } from "@travelsafe/crime-data/cities";
import { getDiscoveredAreasStale as sdpdStale } from "@travelsafe/crime-data/adapters/sdpd-nibrs";

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
      const areas = await city.discover().catch(() => []);
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
