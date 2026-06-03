import type { Request, Response, NextFunction } from "express";

// v96 — Sec-Fetch-Site CSRF guard on state-changing methods.
//
// Modern browsers attach Sec-Fetch-Site to every request initiated
// from a page:
//   - "same-origin" : fetch / form submit from our own page
//   - "same-site"   : sibling subdomain or related origin
//   - "none"        : user typed URL, used a bookmark, or
//                     restored a tab — never a cross-site script
//   - "cross-site"  : a third-party page (or a malicious form)
//                     POSTed to our API while the user was logged in
//
// Block "cross-site" on POST/PUT/PATCH/DELETE — that's exactly the
// CSRF vector. Reads (GET/HEAD/OPTIONS) and same-origin / same-site
// / none writes are all allowed.
//
// What this DOESN'T defend against:
//   - Non-browser clients that don't send Sec-Fetch-Site at all (curl,
//     Postman, server-to-server). We allow those — they're not the
//     CSRF threat model. CSRF requires an authenticated browser
//     session that an attacker tricks into making a request.
//   - Old browsers (IE, Edge Legacy, Safari <16.4). They don't send
//     the header so the request is allowed, but those browsers are
//     a negligible share of US traffic and the rate-limit + auth
//     check still apply.
//
// fix(audit pentest-csrf-stale-native-comment): a Capacitor iOS/Android app DOES
// ship (it loads communitysafe.app in a WebView). Same-origin WebView requests
// send Sec-Fetch-Site: same-origin (or none for app-initiated navigations), both
// of which pass this guard, so no retrofit is needed — but note this surface IS
// reached by the native shell, not hypothetical. (The web's primary CSRF defense
// is the Bearer/Authorization context anyway; this Sec-Fetch-Site check is
// defense-in-depth.)

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Endpoints that legitimately receive cross-site requests. Add paths
// here ONLY if you're sure: each one is a CSRF vector for any
// authenticated session that hits it.
const ALLOWLIST = new Set<string>([
  // Trusted-contact confirmation link is clicked from the contact's
  // own inbox (which is another origin); the request must succeed.
  // The :token in the path is its own bearer credential, so CSRF
  // protection here is redundant with token unguessability.
]);

export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING.has(req.method)) {
    next();
    return;
  }
  if (ALLOWLIST.has(req.path)) {
    next();
    return;
  }
  const site = (req.headers["sec-fetch-site"] as string | undefined) ?? null;
  if (site === null) {
    // No header sent — likely a non-browser client (curl, native, S2S).
    // Allow; the threat model is browser-based CSRF.
    next();
    return;
  }
  if (site === "same-origin" || site === "same-site" || site === "none") {
    next();
    return;
  }
  res.status(403).json({
    error: "csrf_blocked",
    message:
      "Cross-site state-changing requests are blocked. If you reached this from your own client, retry from the app.",
  });
}
