// v96 — Prisma's typed config file. The legacy `package.json#prisma`
// block (where we used to declare the seed script) is deprecated in
// Prisma 6 and will be removed in Prisma 7; moving here clears the
// deprecation warning and sets the workspace up for the eventual v7
// bump without changing any runtime behavior.
//
// The schema path stays at the default ./prisma/schema.prisma. Only
// the seed command needs to be carried over.
//
// Side effect of adopting prisma.config.ts: Prisma's CLI stops
// auto-loading .env files (it now expects DATABASE_URL to be set as
// a real environment variable, the way Railway and Vercel both
// inject it). For local development where DATABASE_URL lives in a
// .env file, we restore the auto-load by importing dotenv at the top
// of this config — that's invoked before the CLI reads the schema.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env" });
loadEnv({ path: "../../.env" }); // monorepo root .env fallback

// v99 — `prisma generate` doesn't open a database connection, but Prisma 7's
// `env("DATABASE_URL")` resolves EAGERLY at config load and throws
// `PrismaConfigEnvError` when the var is unset. That broke CI (the "Generate
// Prisma client" step runs without DATABASE_URL) and any other generate-only
// context. Read it ourselves with a non-connectable placeholder fallback so
// generate never throws; Migrate / db push / deploy / studio still use the
// real URL injected by Railway/Vercel/.env, and a genuinely-missing one fails
// loudly at connect time (against the placeholder) instead of silently
// targeting the wrong database.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // v7 — the connection URL is no longer allowed in schema.prisma's datasource
  // block; the CLI (Migrate / db push / studio) reads it from here instead.
  // Runtime PrismaClient connections use the @prisma/adapter-pg driver adapter,
  // not this value.
  datasource: { url: databaseUrl },
});
