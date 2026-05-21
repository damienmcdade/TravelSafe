"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, setToken } from "@/lib/api-client";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      setToken(r.token);
      router.push("/onboarding/alert-preferences");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="font-display text-3xl text-slate2-900">Create your account</h1>
      <p className="mt-2 text-slate2-500 text-sm">
        Optional — only needed if you want to post, set up trusted contacts, or use the check-in timer.
        Email + password only. We don&apos;t ask for or store demographic information.
      </p>
      <form className="mt-8 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-sm text-slate2-700">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full px-3 py-2 surface" />
        </div>
        <div>
          <label className="text-sm text-slate2-700">Password (min 8 chars)</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full px-3 py-2 surface" />
        </div>
        <div>
          <label className="text-sm text-slate2-700">Display name (optional)</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full px-3 py-2 surface" />
        </div>
        {error && <p className="text-sm text-dusk-700">{error}</p>}
        <button type="submit" disabled={busy} className="w-full px-4 py-2 bg-slate2-900 text-sand-50 rounded-xl disabled:opacity-50">
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate2-500">
        Already have an account? <Link className="underline" href="/login">Sign in</Link>.
      </p>
    </main>
  );
}
