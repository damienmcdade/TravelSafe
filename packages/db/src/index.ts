// Prisma 7 — the client is generated into ./generated/prisma (see schema.prisma
// db_client generator) and a driver adapter is mandatory: `new PrismaClient()`
// without `adapter` throws in v7. The connection string moves from the schema's
// datasource (no longer allowed) to the @prisma/adapter-pg adapter here.
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// fix(audit db-ssl-1): the previous regex only upgraded require/prefer/verify-ca
// and silently no-op'd on `sslmode=disable` or a missing sslmode, so the
// documented "SSL pinned to verify-full" guarantee could fail open against a
// downgraded production DSN. Now force verify-full whenever ANY sslmode is
// present (covers disable/downgrade); a URL with no sslmode is treated as a
// local/no-SSL DSN and left untouched so local dev still works.
export function pinSslVerifyFull(url: string): string {
  if (!url) return url;
  return /sslmode=/i.test(url) ? url.replace(/sslmode=[^&\s]*/i, "sslmode=verify-full") : url;
}

const adapter = new PrismaPg({ connectionString: pinSslVerifyFull(process.env.DATABASE_URL ?? "") });

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
