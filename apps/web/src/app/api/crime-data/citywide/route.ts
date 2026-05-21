import { NextResponse } from "next/server";
import { wrap } from "@/server/lib/http";
import { crimeData } from "@/server/services/crime-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = wrap(async () => NextResponse.json(await crimeData.getCitywide()));
