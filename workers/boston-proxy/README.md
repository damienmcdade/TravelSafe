# Boston proxy (Cloudflare Worker)

Tiny proxy that forwards CKAN `datastore_search` requests from TravelSafe's Vercel runtime through Cloudflare's edge to `data.boston.gov`. It exists because `data.boston.gov` returns zero records when called directly from Vercel's IP range, despite the same requests succeeding from every other host. Cloudflare's edge IPs aren't filtered, so this Worker is the bypass.

## What it does
- One endpoint: `GET /datastore_search?<CKAN params>` → proxies to `https://data.boston.gov/api/3/action/datastore_search?<same params>`
- Hard allow-list of CKAN params (`resource_id`, `limit`, `offset`, `sort`, `q`, `filters`, `fields`, `plain`, `language`) so the Worker can't be turned into a generic open proxy
- 5-minute edge cache (matches TravelSafe's server-side adapter TTL)
- Permissive CORS (callable from browser too, in case the client ever needs it directly)

## Deploy
```bash
cd workers/boston-proxy
npm install
npx wrangler login        # one-time, opens browser
npx wrangler deploy
```

You'll get a URL like:
```
https://travelsafe-boston-proxy.<your-cf-subdomain>.workers.dev
```

## Wire it into the Vercel deployment
Set the env var on Vercel:
```bash
vercel env add BOSTON_PROXY_URL production
# Paste the workers.dev URL when prompted.
```

Then redeploy:
```bash
vercel deploy --prod
```

The Boston adapter checks `BOSTON_PROXY_URL` at startup; if set, it routes through the Worker, otherwise it falls back to a direct `data.boston.gov` call (which currently returns 0 from Vercel — but the fallback keeps non-Vercel deployments working).

## Free tier
Cloudflare Workers free tier: 100,000 requests/day. With the 5-minute edge cache + TravelSafe's 5-minute server cache, the steady-state load is well under 100 requests/day even at full traffic.

## Smoke test the Worker
```bash
curl "https://travelsafe-boston-proxy.<your-subdomain>.workers.dev/datastore_search?resource_id=b973d8cb-eeb2-4e7e-99da-c92938efc9c0&limit=3" | jq '.result.records | length'
# Expected: 3
```
