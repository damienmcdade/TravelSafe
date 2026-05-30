import { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });

declare global {

  var __travelsafePrisma: ReturnType<typeof buildClient> | undefined;
}

// v96 — Prisma client extension that auto-filters out soft-deleted
// users (`deletedAt IS NULL`) on every read against the User model.
// The security audit flagged that the soft-delete contract relied on
// every handler remembering to include the filter — one missed
// findFirst / findMany would leak a deleted user's data. Wrapping it
// at the client layer makes the filter unforgettable. Writes (update,
// upsert) intentionally pass through so softDeleteAccount() can
// still set the deletedAt column. The auth middleware also short-
// circuits soft-deleted sessions before any handler runs, so this is
// defense in depth.
function buildClient() {
  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });
  // v96p2 — for AND-composable shapes (findFirst / findMany / count)
  // use explicit `AND: [args.where, { deletedAt: null }]` instead of
  // top-level spread. Prisma implicitly AND's where keys so both
  // shapes are equivalent today, but the explicit AND is robust
  // against a caller that passes `{ OR: [...] }` (a top-level spread
  // would silently turn it into `{ OR: [...], deletedAt: null }` =
  // (OR clause) AND deletedAt-null, which IS correct intent, but the
  // explicit AND is unambiguous and survives any future refactor
  // that tries to clear `where`). findUnique's WhereUniqueInput
  // doesn't accept `AND`, so the spread there is the only option;
  // it's also semantically correct ("find this unique row only when
  // not soft-deleted").
  return base.$extends({
    name: "soft-delete-user-filter",
    query: {
      user: {
        async findUnique({ args, query }) {
          return query({ ...args, where: { ...args.where, deletedAt: null } as Prisma.UserWhereUniqueInput });
        },
        async findFirst({ args, query }) {
          const base = args.where;
          return query({ ...args, where: base ? { AND: [base, { deletedAt: null }] } : { deletedAt: null } });
        },
        async findMany({ args, query }) {
          const base = args.where;
          return query({ ...args, where: base ? { AND: [base, { deletedAt: null }] } : { deletedAt: null } });
        },
        async count({ args, query }) {
          const base = args.where;
          return query({ ...args, where: base ? { AND: [base, { deletedAt: null }] } : { deletedAt: null } });
        },
      },
    },
  });
}

export const prisma = globalThis.__travelsafePrisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__travelsafePrisma = prisma;
}
