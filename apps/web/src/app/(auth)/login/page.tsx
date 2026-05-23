"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, setToken } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
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
      <form className="mt-8 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-sm text-slate2-700">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 input" />
        </div>
        <div>
          <label className="text-sm text-slate2-700">Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 input" />
        </div>
        {error && <p className="text-sm text-dusk-700">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate2-500">
        New to TravelSafe? You don&apos;t need an account to browse —
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
