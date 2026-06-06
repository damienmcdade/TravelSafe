"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { api } from "@/lib/api-client";

// Leaflet needs `window`; load the map client-only.
const ShareLiveMap = dynamic(() => import("@/components/ShareLiveMap"), {
  ssr: false,
  loading: () => <div className="h-[360px] w-full rounded-xl bg-bay-50 animate-pulse" />,
});

interface ShareView {
  expiresAt: string;
  lat: number | null;
  lng: number | null;
  locationAt: string | null;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const [view, setView] = useState<ShareView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0); // re-render to refresh the "Xs ago" label
  const stopped = useRef(false);

  useEffect(() => {
    if (!params?.token) return;
    stopped.current = false;
    const load = () =>
      api<ShareView>(`/share/${params.token}`)
        .then((v) => { if (!stopped.current) { setView(v); setError(null); } })
        .catch((e) => { if (!stopped.current) setError((e as Error).message); });
    load();
    // Poll for the sharer's latest position while the link is live; a 410
    // (expired/revoked) surfaces via the error path and the map drops away.
    const poll = window.setInterval(load, 12_000);
    const tick = window.setInterval(() => force((n) => n + 1), 1_000);
    return () => { stopped.current = true; window.clearInterval(poll); window.clearInterval(tick); };
     
  }, [params?.token]);

  const hasLoc = view && view.lat != null && view.lng != null;

  return (
    <main className="max-w-lg mx-auto px-6 py-12">
      <h1 className="font-display text-3xl text-slate2-900">CommunitySafe — live location</h1>

      {error && (
        <p className="mt-6 text-dusk-700">This Live Share link is no longer active ({error}).</p>
      )}

      {view && !error && (
        <section className="mt-6 space-y-4">
          {hasLoc ? (
            <>
              <ShareLiveMap lat={view.lat as number} lng={view.lng as number} />
              <div className="surface p-4 text-sm text-slate2-700 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <span className="relative inline-flex w-2.5 h-2.5">
                    <span className="absolute inset-0 rounded-full bg-sage-500 animate-ping" />
                    <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-sage-500" />
                  </span>
                  Live — updated {ago(view.locationAt)}
                </span>
                <span className="text-slate2-500 text-xs tabular-nums">
                  {(view.lat as number).toFixed(5)}, {(view.lng as number).toFixed(5)}
                </span>
              </div>
            </>
          ) : (
            <div className="surface p-6 text-sm text-slate2-700">
              <p>A contact is sharing their live location with you.</p>
              <p className="mt-2 text-slate2-500">
                Waiting for their device to send a position… this page updates automatically.
                (They may have just started, or location may be off on their device.)
              </p>
            </div>
          )}
          <p className="text-xs text-slate2-500">
            Active until <strong>{new Date(view.expiresAt).toLocaleString()}</strong>. The link stops
            working at expiry, or sooner if they revoke it. In an emergency, contact local authorities
            directly.
          </p>
        </section>
      )}
    </main>
  );
}
