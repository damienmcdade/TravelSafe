// v90p3 — Pooled HTTP dispatcher split out of lib/http.ts because the
// undici import broke the Vercel webpack build (undici depends on
// node:fs, node:dns, node:diagnostics_channel and friends that
// webpack can't bundle for the Edge runtime). lib/http.ts is imported
// transitively from every adapter, which is imported transitively
// from the crime-data dispatcher, which is imported from apps/web
// route handlers for the local-fallback path — so undici was getting
// pulled into the client bundle and breaking it.
//
// This file is server-ONLY. apps/api/src/index.ts is the only intended
// caller. Vercel routes never reach this file because they proxy to
// Railway via tryProxy() instead of computing locally.

let installed = false;

export async function installPooledDispatcher(): Promise<void> {
  if (installed) return;
  installed = true;
  // Dynamic import so webpack tree-shakes this branch from any
  // accidental client-side import path. The real call site is
  // apps/api/src/index.ts which runs on Node.
  const { Agent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connections: 10,
    pipelining: 1,
  }));
}
