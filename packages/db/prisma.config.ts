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

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
