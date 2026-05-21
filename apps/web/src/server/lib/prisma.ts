import "server-only";
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __travelsafePrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__travelsafePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__travelsafePrisma = prisma;
}
