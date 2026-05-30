// v99 (Prisma 7) — crime-data is fully decoupled from Prisma. CrimeCategory used
// to come from @prisma/client (the NIBRS top-level grouping enum). In Prisma 7
// the client is generated into an app-local output dir, and pure data adapters
// shouldn't depend on the ORM anyway. It's a stable 3-value NIBRS enum, so it
// lives here as a const object. Values match the DB schema's CrimeCategory enum
// EXACTLY (string literals), so adapter output stays assignment-compatible with
// the Prisma-typed columns the API/web write to.
export const CrimeCategory = {
  PERSONS: "PERSONS",
  PROPERTY: "PROPERTY",
  SOCIETY: "SOCIETY",
} as const;
export type CrimeCategory = (typeof CrimeCategory)[keyof typeof CrimeCategory];
