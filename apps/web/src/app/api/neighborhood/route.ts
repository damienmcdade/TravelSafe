import { NextResponse } from "next/server";
import { AreaKind } from "@/generated/prisma/client";
import { wrap } from "@/server/lib/http";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";
export const GET = wrap(async () => {
  // fix(audit neighborhood-unbounded-take): cap the result set so a large
  // jurisdiction (or an accidental schema growth) can't return an unbounded
  // list. 200 comfortably covers every city's neighborhood count.
  const areas = await prisma.area.findMany({ where: { kind: AreaKind.NEIGHBORHOOD }, orderBy: { name: "asc" }, take: 200 });
  return NextResponse.json(areas);
});
