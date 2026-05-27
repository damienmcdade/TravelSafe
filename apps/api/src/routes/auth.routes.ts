import { Router } from "express";
import { z } from "zod";
import { authLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";
import { register, login, me, refreshAccessToken, logout, verifyMfaAndIssueTokens } from "../services/auth.service.js";
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
// returns mfaRequired:true with a pendingUserId. The client POSTs the
// pendingUserId + the user's current TOTP code.
authRouter.post("/mfa/verify", authLimiter, async (req, res, next) => {
  try {
    const { pendingUserId, code } = z.object({
      pendingUserId: z.string().min(10).max(100),
      code: z.string().regex(/^\d{6}$/),
    }).parse(req.body);
    const result = await verifyMfaAndIssueTokens(pendingUserId, code);
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
