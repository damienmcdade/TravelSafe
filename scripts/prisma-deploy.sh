#!/usr/bin/env bash
# Railway preDeployCommand wrapper — `prisma migrate deploy` with a one-time
# baseline-resolve for the existing (db-push-era) database.
#
# v100 (Prisma 7 cutover): two changes from the v6 script —
#   1. Run from packages/db, NOT the repo root. In v7 the connection URL and
#      schema path live in prisma.config.ts (the schema's datasource block no
#      longer carries `url`). The config uses RELATIVE paths ("prisma/schema.
#      prisma"), and the v7 CLI auto-loads prisma.config.ts from the current
#      directory — so prisma must run from packages/db. We therefore drop the
#      `--schema` flag and let the config supply both schema + datasource url.
#   2. Pin `prisma@7.8.0` via npx so the CLI version can't be a stale v6 binary
#      served from a build-cache layer (the symptom that blocked the first two
#      cutover attempts — Railway generated a v6.19.3 client).
#
# Baselining: the production Neon DB was populated via `db push` for ~95
# versions before migrations existed, so its _prisma_migrations table is empty
# while the schema is fully populated. We mark 0_init applied once; the `|| true`
# swallows the expected "already recorded as applied" error on every later deploy.
# The v7 migration changes NO database schema (it is a client-generation change
# only), so `migrate deploy` is a no-op here — it just validates connectivity.

set -e

cd "$(dirname "$0")/.." || exit 1
cd packages/db || exit 1   # where prisma.config.ts + its relative paths resolve

PRISMA="npx -y prisma@7.8.0"

echo "[prisma-deploy] resolving baseline (0_init)..."
{
  $PRISMA migrate resolve --applied 0_init 2>&1 || true
} | grep -Ev '^(Error: P3008|Prisma schema loaded|Prisma config|Loaded Prisma config|Datasource "db"|The migration [A-Za-z0-9._-]+ is already recorded as applied|$)' \
  || echo "[prisma-deploy] baseline already resolved (expected on subsequent deploys)"

echo "[prisma-deploy] applying pending migrations..."
# fix(deploy logs — P1002): `migrate deploy` acquires a Postgres advisory lock
# (pg_advisory_lock) with a 10s timeout. Two deploys racing for that lock — e.g.
# a `railway up` followed quickly by a redeploy — can make one time out with
# `Error: P1002 ... Timed out trying to acquire a postgres advisory lock`, which
# (unlike the `|| true` baseline-resolve above) would abort the whole deploy.
# Retry the deploy a few times on that transient lock contention; a real schema
# error still fails after the retries are exhausted. migrate deploy is idempotent
# (already-applied migrations are skipped), so retrying is safe.
attempt=1
until $PRISMA migrate deploy; do
  if [ "$attempt" -ge 4 ]; then
    echo "[prisma-deploy] migrate deploy failed after $attempt attempts — aborting"
    exit 1
  fi
  echo "[prisma-deploy] migrate deploy attempt $attempt failed (likely advisory-lock contention); retrying in $((attempt * 5))s..."
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
done
