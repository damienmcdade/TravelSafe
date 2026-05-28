import { Router } from "express";
import { z } from "zod";
import { authLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";
import { register, login, me, refreshAccessToken, logout, verifyMfaAndIssueTokens, softDeleteAccount } from "../services/auth.service.js";
import { generateProvisional, verifyAndEnableMfa, disableMfa } from "../services/mfa.service.js";
import { writeSecurityAudit } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email().toLowerCase(),
  // v92 — min 12 chars (DISA STIG IA-5). 8 was below the FedRAMP baseline.
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
  displayName: z.string().min(1).max(80).optional(),
});

authRouter.post("/register", authLimiter, async (req, res, next) => {
  try {
    const { email, password, displayName } = credentials.parse(req.body);
    const result = await register(email, password, displayName);
    writeSecurityAudit({ event: "auth.register", userId: result.user.id, email, req });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = credentials.parse(req.body);
    try {
      const result = await login(email, password);
      writeSecurityAudit({ event: "auth.login.success", userId: result.user.id, email, req });
      res.json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.code === "account_locked") {
          writeSecurityAudit({ event: "auth.login.fail.locked", email, req });
        } else if (err.code === "banned") {
          writeSecurityAudit({ event: "auth.login.fail.banned", email, req });
        } else if (err.code === "invalid_credentials") {
          writeSecurityAudit({ event: "auth.login.fail.bad_password", email, req });
        }
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    res.json(await me(req.session!.uid));
  } catch (err) {
    next(err);
  }
});

// v93p2 — short-TTL access-token refresh endpoint. Client sends the
// long-TTL refresh token; we mint a fresh access token (15 min TTL).
// The refresh token itself isn't rotated here. If the user's
// tokenVersion has advanced (logout / password change / "sign out
// everywhere") this returns 401 token_revoked.
//
// v96 — CSRF posture documented per the security audit. This endpoint
// does NOT sit behind the Sec-Fetch-Site CSRF guard for two reasons:
//   1. The refresh token is a 256-bit HS256 JWT (jwt.io decodable but
//      cryptographically unforgeable without JWT_SECRET) in the body,
//      not a cookie. CSRF attacks rely on the browser auto-sending
//      cookies; a body-supplied bearer-style token can only be sent
//      by a client that already has it, which (by definition) is the
//      same client that performed the original login. There is no
//      "ambient authority" the attacker can hijack.
//   2. authLimiter caps to 20 attempts per 15 min per IP — even if a
//      token did leak (via log, accidental commit, third-party
//      script), the brute-force surface is bounded.
// If we ever move refresh to httpOnly cookies, this CSRF exemption
// must be revisited.
authRouter.post("/refresh", authLimiter, async (req, res, next) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20).max(2000) }).parse(req.body);
    res.json(await refreshAccessToken(refreshToken));
  } catch (err) {
    next(err);
  }
});

// v93p2 — bumps the user's tokenVersion. All existing access AND
// refresh tokens become invalid; the next call returns token_revoked
// and the client must re-authenticate.
authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await logout(req.session!.uid);
    writeSecurityAudit({ event: "auth.token.refresh", userId: req.session!.uid, email: req.session!.email, req, detail: { action: "logout" } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// v96 — GDPR / CCPA right-to-be-forgotten path. Soft-delete the
// caller's own account: obfuscate email, null the display name, bump
// tokenVersion to invalidate every active token. The row stays in
// the DB until the retention worker hard-deletes past the grace
// window. Service-layer enforces the auth check; the caller can
// only delete their OWN account.
authRouter.post("/account/delete", requireAuth, async (req, res, next) => {
  try {
    await softDeleteAccount(req.session!.uid);
    writeSecurityAudit({ event: "account.delete", userId: req.session!.uid, email: req.session!.email, req, detail: { action: "soft-delete" } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// v93p3 — MFA enrollment flow. Step 1: caller is authenticated, asks
// for a provisional secret. We DO NOT store the secret here — caller
// must verify a code via /auth/mfa/verify-enroll before persistence.
authRouter.post("/mfa/enroll", requireAuth, async (req, res, next) => {
  try {
    const provisional = generateProvisional(req.session!.email);
    writeSecurityAudit({ event: "auth.mfa.enroll", userId: req.session!.uid, email: req.session!.email, req });
    res.json(provisional);
  } catch (err) {
    next(err);
  }
});

// v93p3 — MFA enrollment Step 2: client returns the secret from
// Step 1 alongside the user's first code. We re-verify and persist.
authRouter.post("/mfa/verify-enroll", requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { secret, code } = z.object({
      secret: z.string().min(16).max(200),
      code: z.string().regex(/^\d{6}$/),
    }).parse(req.body);
    await verifyAndEnableMfa(req.session!.uid, secret, code);
    writeSecurityAudit({ event: "auth.mfa.enable", userId: req.session!.uid, email: req.session!.email, req });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// v93p3 — login second-factor verification. Called after /auth/login
// returns mfaRequired:true with an mfaPendingToken. The client POSTs
// the token (a 5-minute JWT carrying the uid) + the user's current
// TOTP code.
// v96 — switched from `pendingUserId` (raw id) to `mfaPendingToken`
// (signed JWT) so a brute-forcer cannot challenge arbitrary user ids
// over the distributed-IP rate limit window.
authRouter.post("/mfa/verify", authLimiter, async (req, res, next) => {
  try {
    const { mfaPendingToken, code } = z.object({
      mfaPendingToken: z.string().min(10).max(2000),
      code: z.string().regex(/^\d{6}$/),
    }).parse(req.body);
    const result = await verifyMfaAndIssueTokens(mfaPendingToken, code);
    writeSecurityAudit({ event: "auth.login.success", userId: result.user.id, email: result.user.email, req, detail: { mfa: true } });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// v93p3 — disable MFA (requires a current code).
authRouter.post("/mfa/disable", requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    await disableMfa(req.session!.uid, code);
    writeSecurityAudit({ event: "auth.mfa.disable", userId: req.session!.uid, email: req.session!.email, req });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
