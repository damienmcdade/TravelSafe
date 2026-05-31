// Prisma 7 — the client is generated into ./generated/prisma (see schema.prisma
// db_client generator) and a driver adapter is mandatory: `new PrismaClient()`
// without `adapter` throws in v7. The connection string moves from the schema's
// datasource (no longer allowed) to the @prisma/adapter-pg adapter here.
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: (process.env.DATABASE_URL ?? "").replace(/sslmode=(?:require|prefer|verify-ca)/i, "sslmode=verify-full") });

declare global {
  // eslint-disable-next-line no-var
  var __travelsafePrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__travelsafePrisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__travelsafePrisma = prisma;
}

export * from "./generated/prisma/client.js";
