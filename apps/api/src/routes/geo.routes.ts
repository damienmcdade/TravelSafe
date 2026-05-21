import { Router } from "express";
import { z } from "zod";
import { lookupLocation, allKnownAreas } from "../services/geo/lookup.service.js";

export const geoRouter = Router();

geoRouter.get("/lookup", async (req, res, next) => {
  try {
    const q = z.string().min(1).max(200).parse(req.query.q ?? "");
    const result = await lookupLocation(q);
    if (!result) return res.status(404).json({ error: "no_match" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

geoRouter.get("/areas", (_req, res) => {
  res.json(allKnownAreas());
});
