"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api-client";

// fix(audit pentest-authn-6): request a password-reset email. Always shows the
// same confirmation (no account enumeration).
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
    } catch {
      /* never reveal whether the account exists */
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16 animate-rise-in">
      <h1 className="font-display text-3xl text-slate2-900">Reset your password</h1>
      {sent ? (
        <p className="mt-6 text-sm text-slate2-700" role="status">
          If an account exists for <strong>{email}</strong>, we&apos;ve emailed a reset link. It&apos;s
          valid for one hour. Check your inbox (and spam).{" "}
          <Link className="underline hover:text-bay-700" href="/login">Back to sign in</Link>.
        </p>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="fp-email" className="text-sm text-slate2-700">Email</label>
            <input id="fp-email" name="email" type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} className="mt-1 input" />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
            {busy ? "Sending…" : "Email me a reset link"}
          </button>
          <p className="text-sm text-slate2-500">
            <Link className="underline hover:text-bay-700" href="/login">Back to sign in</Link>
          </p>
        </form>
      )}
    </main>
  );
}
