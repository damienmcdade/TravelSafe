import { NextResponse } from "next/server";
import { wrap } from "@/server/lib/http";
import { getOfficialAlerts } from "@/server/services/official-alerts/nws";

export const dynamic = "force-dynamic";
export const GET = wrap(async () => {
  return NextResponse.json({
    sources: ["National Weather Service"],
    alerts: await getOfficialAlerts(),
    disclaimer: "These alerts come from official sources (currently the National Weather Service). They are independent of TravelSafe community posts.",
  });
});
