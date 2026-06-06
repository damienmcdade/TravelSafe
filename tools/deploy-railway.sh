#!/usr/bin/env bash
# Manual Railway deploy that keeps GIT_COMMIT_SHA in lockstep with the deployed
# code. Use THIS instead of a bare `railway up`.
#
# Why: `railway up` is a CLI file upload with NO git context, so it never updates
# GIT_COMMIT_SHA. /health then reports a stale SHA and the sync-check
# deploy-coherence probe FAILS even though the code is in lockstep — the
# recurring "DEPLOY SKEW: vercel=… railway=…" red check. This script sets the SHA
# first (so the new container boots reporting it) then ships the code. Mirrors the
# CI deploy-railway job (.github/workflows/ci.yml).
#
# The real fix is setting the RAILWAY_TOKEN repo secret so CI auto-deploys on
# every push to main; until then, run this from the repo root after merging.
#
#   bash tools/deploy-railway.sh
#
# Requires the project linked (`railway link`) or RAILWAY_TOKEN exported.
set -euo pipefail

SVC=6a7c8ff7-b038-48d1-a623-d37ffe686011   # communitysafe-api service id
SHA=$(git rev-parse --short=7 HEAD)

echo "[deploy] stamping GIT_COMMIT_SHA=$SHA (so /health + sync-check are coherent)…"
railway variables --service "$SVC" --set "GIT_COMMIT_SHA=$SHA"

echo "[deploy] uploading + building current tree…"
railway up --service "$SVC" --detach

echo "[deploy] queued. The new container will report commit=$SHA once the /health"
echo "         healthcheck passes. Verify: curl -s …/health | grep commit"
