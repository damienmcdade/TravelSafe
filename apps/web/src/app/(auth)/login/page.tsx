"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, setToken } from "@/lib/api-client";

type LoginResponse =
  | { token: string }
  | { mfaRequired: true; mfaPendingToken: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // fix(audit pentest-authn-1): two-step login. When the account has MFA
  // enabled the password POST returns a pending ticket instead of a token and
  // we show the TOTP code step.
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if ("mfaRequired" in r) {
        setMfaPendingToken(r.mfaPendingToken);
        return;
      }
      setToken(r.token);
      router.push("/threats");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ mfaPendingToken, code }),
      });
      setToken(r.token);
      router.push("/threats");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16 animate-rise-in">
      <h1 className="font-display text-3xl text-slate2-900">Sign in</h1>
      {mfaPendingToken ? (
        <form className="mt-8 space-y-4" onSubmit={onVerifyMfa} aria-describedby={error ? "login-error" : undefined}>
          <p className="text-sm text-slate2-700">
            Enter the 6-digit code from your authenticator app to finish signing in.
          </p>
          <div>
            <label htmlFor="mfa-code" className="text-sm text-slate2-700">Verification code</label>
            <input
              id="mfa-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1 input tracking-widest"
            />
          </div>
          {error && <p id="login-error" role="alert" className="text-sm text-dusk-700">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full disabled:opacity-50">
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={onSubmit} aria-describedby={error ? "login-error" : undefined}>
          <div>
            <label htmlFor="login-email" className="text-sm text-slate2-700">Email</label>
            <input id="login-email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 input" />
          </div>
          <div>
            <label htmlFor="login-password" className="text-sm text-slate2-700">Password</label>
            <input id="login-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 input" />
          </div>
          {error && <p id="login-error" role="alert" className="text-sm text-dusk-700">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-sm text-slate2-500">
            <Link className="underline hover:text-bay-700 transition-colors" href="/forgot-password">Forgot your password?</Link>
          </p>
        </form>
      )}
      <p className="mt-4 text-sm text-slate2-500">
        New to CommunitySafe? You don&apos;t need an account to browse —
        every device gets an anonymous session automatically. Sign-in
        is only needed if you previously created an account.{" "}
        <Link className="underline hover:text-bay-700 transition-colors" href="/threats">
          Skip to the app
        </Link>
        .
      </p>
    </main>
  );
}
