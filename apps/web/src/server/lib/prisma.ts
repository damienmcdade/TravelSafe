import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// fix(audit db-ssl-1): force verify-full whenever ANY sslmode is present (the
// old regex no-op'd on sslmode=disable / no sslmode, failing the SSL guarantee
// open). A DSN with no sslmode is left as-is for local/no-SSL dev.
function pinSslVerifyFull(url: string): string {
  if (!url) return url;
  return /sslmode=/i.test(url) ? url.replace(/sslmode=[^&\s]*/i, "sslmode=verify-full") : url;
}

const adapter = new PrismaPg({ connectionString: pinSslVerifyFull(process.env.DATABASE_URL ?? "") });

declare global {

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
