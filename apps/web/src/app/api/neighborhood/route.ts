import { NextResponse } from "next/server";
import { AreaKind } from "@prisma/client";
import { wrap } from "@/server/lib/http";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";
export const GET = wrap(async () => {
  const areas = await prisma.area.findMany({ where: { kind: AreaKind.NEIGHBORHOOD }, orderBy: { name: "asc" } });
  return NextResponse.json(areas);
});
