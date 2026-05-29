#!/usr/bin/env bash
# v96 — Railway preDeployCommand wrapper. Replaces `prisma db push`
# (destructive on schema drift) with the safer `prisma migrate deploy`
# flow, plus a one-time baseline-resolve step for the existing
# database.
#
# How baselining works:
#   * The production Neon database was populated via `db push` for
#     ~95 versions before migrations existed. The first migrate-deploy
#     run against it would fail because the `_prisma_migrations`
#     table is empty but the schema is fully populated.
#   * We therefore mark the initial migration (`0_init`) as already
#     applied. The `|| true` swallows the expected error on every
#     subsequent deploy when the migration is already resolved —
#     it's safe because Prisma exits non-zero in exactly that case.
#   * After the baseline is in place, future migrations are added
#     via `prisma migrate dev` locally and applied on deploy via
#     `migrate deploy`.
#
# What this script does NOT handle: the very first deploy after
# committing the migration baseline. That deploy needs the operator
# to set `MIGRATIONS_BASELINED=1` as a Railway env var on the FIRST
# run only (so `migrate resolve` runs), then the env var stays set
# (so subsequent runs see it but the `|| true` swallows the
# "already applied" error). Or alternatively, ssh into the Railway
# shell once and run `npx prisma migrate resolve --applied 0_init`
# manually, then this script does the right thing on every deploy
# without the env var.

set -e

cd "$(dirname "$0")/.." || exit 1

# Step 1: baseline-resolve the initial migration. Safe to call every
# deploy: Prisma exits 1 with "already recorded as applied" when
# 0_init is already in _prisma_migrations, which we swallow.
# v96p2 — the Prisma CLI prints "Error: P3008 ... migration already
# applied" to stderr on every subsequent deploy, which the deploy-log
# scan flagged as noise. Capture both streams, filter out the
# expected P3008 lines (and the supporting "Datasource" / "schema
# loaded" boilerplate that the CLI emits alongside), and re-emit the
# rest so real failures still surface. The exit-code `|| true` is
# unchanged.
echo "[prisma-deploy] resolving baseline (0_init)..."
{
  npx prisma migrate resolve \
    --applied 0_init \
    --schema packages/db/prisma/schema.prisma 2>&1 || true
} | grep -Ev '^(Error: P3008|Prisma schema loaded|Datasource "db"|The migration .* is already recorded as applied|$)' \
  || echo "[prisma-deploy] baseline already resolved (expected on subsequent deploys)"

# Step 2: apply any new migrations. No-op on a baselined DB with no
# new migrations; runs the new SQL on subsequent deploys.
echo "[prisma-deploy] applying pending migrations..."
npx prisma migrate deploy \
  --schema packages/db/prisma/schema.prisma
