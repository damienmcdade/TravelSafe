"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";

interface ShareView { expiresAt: string; userId: string }

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const [view, setView] = useState<ShareView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.token) return;
    api<ShareView>(`/share/${params.token}`).then(setView).catch((e) => setError((e as Error).message));
  }, [params?.token]);

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="font-display text-3xl text-slate2-900">TravelSafe — shared location</h1>
      {error && <p className="mt-6 text-dusk-700">This link is no longer valid ({error}).</p>}
      {view && !error && (
        <section className="mt-6 surface p-6 text-sm text-slate2-700">
          <p>A contact is sharing their location with you.</p>
          <p className="mt-2">Active until <strong>{new Date(view.expiresAt).toLocaleString()}</strong>.</p>
          <p className="mt-4 text-slate2-500 text-xs">
            Live coordinate streaming is on the roadmap. For now, this link confirms an active
            Live Share session — the sender&apos;s device knows you have this URL and can revoke
            it at any time. In an emergency, contact local authorities directly.
          </p>
        </section>
      )}
    </main>
  );
}
