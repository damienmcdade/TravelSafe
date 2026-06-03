"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";

// fix(audit pentest-authn-6): consume the emailed reset token + set a new
// password. On success every existing session is revoked, so the user signs in
// fresh.
function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 12) { setError("Password must be at least 12 characters."); return; }
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p className="mt-6 text-sm text-dusk-700" role="alert">This reset link is missing its token. Request a new one from <Link className="underline" href="/forgot-password">Reset your password</Link>.</p>;
  }
  if (done) {
    return <p className="mt-6 text-sm text-sage-700" role="status">Your password has been reset and all sessions signed out. <Link className="underline hover:text-bay-700" href="/login">Sign in</Link> with your new password.</p>;
  }
  return (
    <form className="mt-8 space-y-4" onSubmit={onSubmit}>
      <div>
        <label htmlFor="rp-pw" className="text-sm text-slate2-700">New password (min 12 characters)</label>
        <input id="rp-pw" type="password" autoComplete="new-password" required minLength={12} value={password}
          onChange={(e) => setPassword(e.target.value)} className="mt-1 input" />
      </div>
      <div>
        <label htmlFor="rp-pw2" className="text-sm text-slate2-700">Confirm new password</label>
        <input id="rp-pw2" type="password" autoComplete="new-password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)} className="mt-1 input" />
      </div>
      {error && <p role="alert" className="text-sm text-dusk-700">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
        {busy ? "Resetting…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="max-w-md mx-auto px-6 py-16 animate-rise-in">
      <h1 className="font-display text-3xl text-slate2-900">Choose a new password</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-slate2-500">Loading…</p>}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
