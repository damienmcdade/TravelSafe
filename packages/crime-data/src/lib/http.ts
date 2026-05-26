// v87 — Global HTTP dispatcher with keep-alive + per-origin connection
// pooling. Pre-v87 every adapter page-fetch opened a fresh TCP+TLS
// connection (Node's global fetch uses an ephemeral undici dispatcher).
// Per the perf audit: Cleveland 30 pages, DC 60 pages, NYPD 4 pages,
// LA 2 pages = ~50 cold handshakes/min during warm-worker cycles, each
// 200-400ms. Switching to a pooled dispatcher cuts that overhead to
// ~zero on the second-and-subsequent pages.
//
// Sized for our concurrency: per-origin connections=10 (warm-worker
// runs heavy=2 concurrent cities × bounded-pool=4 pages = 8 simultaneous;
// 10 leaves headroom for the routes that also hit upstreams).
import { Agent, setGlobalDispatcher } from "undici";

let installed = false;

export function installPooledDispatcher(): void {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connections: 10,
    pipelining: 1,
  }));
}
