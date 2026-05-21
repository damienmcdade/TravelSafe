import { Router } from "express";
import { getOfficialAlerts } from "../services/official-alerts/nws.service.js";

export const officialAlertsRouter = Router();

officialAlertsRouter.get("/", async (_req, res, next) => {
  try {
    res.json({
      sources: ["National Weather Service"],
      alerts: await getOfficialAlerts(),
      disclaimer:
        "These alerts come from official sources (currently the National Weather Service). " +
        "They are independent of TravelSafe community posts.",
    });
  } catch (err) {
    next(err);
  }
});
