"use client";
import { useEffect, useRef, useState } from "react";
import { api, useAnonymousAuth, useApi } from "@/lib/api-client";
import { requestLocation } from "@/lib/geolocation";
import { SafetyTipsPanel } from "@/components/SafetyTipsPanel";
import { LocationSearch } from "@/components/LocationSearch";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";

const EMERGENCY_DIAL = process.env.NEXT_PUBLIC_EMERGENCY_DIAL || "911";
const DISCLAIMER_KEY = "travelsafe.safety.disclaimer.ack";

interface ActiveTimer {
  id: string;
  scheduledFor: string;
  message: string | null;
}

interface LiveShare {
  id: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface Area { slug: string; label: string; jurisdiction: string }

export default function PersonalSafetyPage() {
  const { city } = useCity();
  // Globally-shared neighborhood selection — Personal Safety follows the
  // same area the user picked elsewhere so safety tips track without a
  // second selection.
  const { area, setArea } = useArea(city.slug);
  useDocumentTitle(`Personal Safety · ${area?.label ?? city.label}`);

  const [showDisclaimer, setShowDisclaimer] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(DISCLAIMER_KEY)) {
      setShowDisclaimer(true);
    }
  }, []);
  function dismissDisclaimer() {
    localStorage.setItem(DISCLAIMER_KEY, "1");
    setShowDisclaimer(false);
  }

  return (
    <main className="space-y-5">
      {showDisclaimer && (
        <div className="surface p-5 border-amber2-500/40">
          <h2 className="font-display text-lg text-slate2-900">Before you use this tab</h2>
          <p className="mt-2 text-sm text-slate2-700">
            TravelSafe&apos;s personal-safety tools may fail due to network, device, or service issues
            and are <strong>not a substitute for 911 or professional emergency services</strong>.
            The application does not contact emergency services on your behalf. In an emergency, call 911.
          </p>
          <button onClick={dismissDisclaimer} className="mt-3 px-3 py-1.5 bg-slate2-900 text-sand-50 rounded-xl text-sm">
            I understand
          </button>
        </div>
      )}

      <EmergencyPanel />

      <section className="surface p-5">
        <h2 className="font-display text-lg text-slate2-900">Tailor safety tips to your area</h2>
        <p className="mt-1 text-xs text-slate2-500">
          Tips below are matched to the offenses most commonly reported in {area ? area.label : city.label}. Switch the city in the header to change region, or search a specific neighborhood here.
        </p>
        <div className="mt-3">
          <LocationSearch current={area} onResolved={setArea} />
        </div>
      </section>

      <SafetyTipsPanel
        areaSlug={area?.slug}
        jurisdictionSlug={!area ? city.slug : undefined}
      />
      <CheckInPanel />
      <LiveSharePanel />
      <AccountPanel />
    </main>
  );
}

// Account / DSAR controls. Surfaces the GDPR/CCPA-compliant Export and
// Delete operations the privacy policy promises. Shows for everyone with
// a session (anonymous device sessions included — they're still User
// rows server-side and the user has the same right to remove them).
//
// The delete-confirmation is treated as a true dialog: it has role/
// aria-modal/aria-labelledby, focuses the first input on open, returns
// focus to the trigger on close, and dismisses on Escape. The audit
// flagged the previous inline panel for failing every one of these.
function AccountPanel() {
  const { ready: signedIn } = useAnonymousAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  // Focus the email field when the dialog opens.
  useEffect(() => {
    if (showConfirm) emailRef.current?.focus();
  }, [showConfirm]);

  // Escape dismisses; focus returns to the trigger button so a keyboard
  // user lands back where they were.
  useEffect(() => {
    if (!showConfirm) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showConfirm]);

  function closeDialog() {
    setShowConfirm(false);
    setConfirmEmail("");
    setConfirmText("");
    setDeleteError(null);
    triggerRef.current?.focus();
  }

  async function exportData() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/account/export", {
        headers: { Authorization: `Bearer ${localStorage.getItem("travelsafe.token") ?? ""}` },
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `travelsafe-account-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(`Export failed: ${(err as Error).message}. Try again in a moment.`);
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    if (confirmText !== "DELETE") {
      setDeleteError("Type DELETE exactly to confirm.");
      return;
    }
    setDeleting(true);
    try {
      await api("/account/delete", {
        method: "POST",
        body: JSON.stringify({ confirmEmail, confirmText }),
      });
      // Local cleanup — drop the session token and everything else.
      localStorage.clear();
      setDeleteSuccess(true);
      // Brief pause so the screen-reader announces the success state
      // before navigation, then bounce to home.
      window.setTimeout(() => { window.location.href = "/"; }, 1500);
    } catch (err) {
      const e = err as Error & { body?: { message?: string } };
      setDeleteError(e.body?.message ?? e.message);
      setDeleting(false);
    }
  }

  if (!signedIn) return null;

  if (deleteSuccess) {
    return (
      <section className="surface p-6" role="status" aria-live="polite">
        <h2 className="font-display text-xl text-slate2-900">Account deleted</h2>
        <p className="mt-2 text-sm text-slate2-700">
          Your account and all associated data have been removed from TravelSafe&apos;s servers. Returning to home…
        </p>
      </section>
    );
  }

  return (
    <section className="surface p-6">
      <h2 className="font-display text-xl text-slate2-900">Your account &amp; data</h2>
      <p className="mt-1 text-sm text-slate2-700">
        TravelSafe stores a session for your device so check-ins, contacts, and posts can be associated with you. Below are the controls the <a href="/privacy" className="text-bay-700 hover:underline">privacy policy</a> describes.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          onClick={exportData}
          disabled={exporting}
          className="btn-secondary text-sm px-4 py-2 disabled:opacity-60 disabled:cursor-wait"
        >
          {exporting ? "Preparing export…" : "Export my data (JSON)"}
        </button>
        <button
          ref={triggerRef}
          onClick={() => setShowConfirm(true)}
          aria-haspopup="dialog"
          aria-expanded={showConfirm}
          className="text-sm px-4 py-2 rounded-xl border border-dusk-700 text-dusk-800 hover:bg-dusk-50"
        >
          Delete my account
        </button>
      </div>

      {exportError && (
        <p role="alert" className="mt-3 text-xs text-dusk-700">{exportError}</p>
      )}

      {showConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          aria-describedby="delete-confirm-desc"
          className="mt-4 surface-muted p-4 border border-dusk-300"
        >
          <p id="delete-confirm-title" className="text-sm text-slate2-900 font-medium">This is irreversible.</p>
          <p id="delete-confirm-desc" className="mt-1 text-xs text-slate2-700">
            Deletes your account, your posts, your comments, your check-in timers, your trusted contacts, your push subscriptions, and your live-share links. Posts that other users have replied to will be removed along with their replies. To confirm, type your account email and the literal word DELETE. Press Escape to cancel.
          </p>
          <div className="mt-3 grid gap-2">
            <label className="text-xs text-slate2-700">
              <span className="block mb-1">Your account email</span>
              <input
                ref={emailRef}
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                className="w-full rounded-xl border border-sand-300 px-3 py-2 text-sm"
                autoComplete="email"
                required
              />
            </label>
            <label className="text-xs text-slate2-700">
              <span className="block mb-1">Type <code className="font-mono">DELETE</code> to confirm</span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full rounded-xl border border-sand-300 px-3 py-2 text-sm font-mono"
                aria-describedby="delete-confirm-desc"
                required
              />
            </label>
          </div>
          {deleteError && <p role="alert" className="mt-2 text-xs text-dusk-700">{deleteError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={confirmDelete}
              disabled={deleting || !confirmEmail || confirmText !== "DELETE"}
              className="text-sm px-4 py-2 rounded-xl bg-dusk-700 text-sand-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              onClick={closeDialog}
              className="text-sm px-4 py-2 rounded-xl border border-sand-300 text-slate2-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function EmergencyPanel() {
  return (
    <section className="surface p-6">
      <h2 className="font-display text-xl text-slate2-900">In an emergency</h2>
      <p className="mt-2 text-slate2-700">
        Call {EMERGENCY_DIAL} directly. The button below opens your device&apos;s dialer —
        it does not route through TravelSafe&apos;s servers and works even if the app backend is down.
      </p>
      <a
        href={`tel:${EMERGENCY_DIAL}`}
        className="mt-4 inline-flex items-center justify-center gap-2 px-6 py-3 bg-dusk-500 text-white rounded-xl text-lg font-medium shadow-card transition-all duration-200 ease-spring hover:bg-dusk-700 hover:-translate-y-0.5 hover:shadow-card-lift active:scale-[0.97]"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-white/80 animate-pulse" />
        Call {EMERGENCY_DIAL}
      </a>
      <p className="mt-3 text-xs text-slate2-500">
        Do not approach, follow, film, or confront anyone. Awareness tools are for context — emergencies are for trained responders.
      </p>
    </section>
  );
}

function CheckInPanel() {
  const { ready: signedIn } = useAnonymousAuth();
  const { data, reload } = useApi<ActiveTimer[]>(signedIn ? "/safety/check-in/active" : null, [signedIn]);
  const active = data?.[0] ?? null;

  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!active) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, +new Date(active.scheduledFor) - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  async function arm() {
    if (!signedIn) return;
    setBusy(true);
    setError(null);
    try {
      let lat: number | undefined, lng: number | undefined;
      try {
        const pos = await requestLocation();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        // Continue without location — the API records null and the alert text says so.
      }
      await api("/safety/check-in", {
        method: "POST",
        body: JSON.stringify({ durationMinutes: duration, message: note || undefined, lat, lng }),
      });
      await reload();
    } catch (err) {
      setError(`Could not arm — ${(err as Error).message}. Backend may be unreachable; the timer is NOT active.`);
    } finally {
      setBusy(false);
    }
  }

  // Separate busy flag for markSafe so the user gets immediate feedback
  // (this is a safety feature — silent fire is genuinely dangerous, the
  // user might tap it twice and not know whether the timer cleared).
  const [safeBusy, setSafeBusy] = useState(false);
  async function markSafe() {
    if (!active || safeBusy) return;
    setSafeBusy(true);
    try {
      await api(`/safety/check-in/${active.id}/safe`, { method: "POST" });
      await reload();
    } finally {
      setSafeBusy(false);
    }
  }

  return (
    <section className="surface p-6">
      <h2 className="font-display text-xl text-slate2-900">Check on me</h2>
      <p className="mt-1 text-sm text-slate2-500">
        Server-side timer. If it expires without you confirming you&apos;re safe, your confirmed contacts get notified.
      </p>

      {active ? (
        <div className="mt-4 surface-muted p-4">
          <div className="text-sm text-slate2-700">Armed — expires in</div>
          <div className="text-2xl font-display text-slate2-900">
            {remaining != null ? formatRemaining(remaining) : "…"}
          </div>
          {active.message && <div className="mt-1 text-sm text-slate2-500">Note: {active.message}</div>}
          <button
            onClick={markSafe}
            disabled={safeBusy}
            className="mt-3 px-4 py-2 bg-sage-500 text-sand-50 rounded-xl disabled:opacity-60 disabled:cursor-wait"
          >
            {safeBusy ? "Clearing…" : "I'm safe — clear timer"}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm sm:col-span-1">
            Duration (minutes)
            <input
              type="number" min={1} max={240} value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 input"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Note (optional, e.g. &quot;walking home from Pacific Beach&quot;)
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 input" />
          </label>
          <button onClick={arm} disabled={busy} className="sm:col-span-3 btn-primary disabled:opacity-50">
            {busy ? "Arming…" : "Arm timer"}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-dusk-700">{error}</p>}
      {!signedIn && (
        <p className="mt-3 text-xs text-slate2-500">Setting up your anonymous device session…</p>
      )}
    </section>
  );
}

function formatRemaining(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function LiveSharePanel() {
  const { ready: signedIn } = useAnonymousAuth();
  const { data, reload } = useApi<LiveShare[]>(signedIn ? "/safety/live-share" : null, [signedIn]);
  // Defensive: drop rows with missing/invalid expiresAt before the
  // date comparison so a malformed cached row doesn't crash render
  // via `new Date(undefined) > new Date()` → invalid Date NaN flow.
  const active = (data ?? []).filter((s) => {
    if (s.revokedAt) return false;
    if (!s.expiresAt) return false;
    const t = new Date(s.expiresAt).getTime();
    return Number.isFinite(t) && t > Date.now();
  });

  const [duration, setDuration] = useState(30);
  const [contactEmail, setContactEmail] = useState("");
  const [lastShare, setLastShare] = useState<{ shareUrl: string; expiresAt: string } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function create() {
    if (!signedIn || createBusy) return;
    setCreateBusy(true);
    try {
      const r = await api<{ shareUrl: string; expiresAt: string }>("/safety/live-share", {
        method: "POST",
        body: JSON.stringify({ durationMinutes: duration, contactEmail: contactEmail || undefined }),
      });
      setLastShare(r);
      await reload();
    } finally {
      setCreateBusy(false);
    }
  }

  async function revoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    try {
      await api(`/safety/live-share/${id}`, { method: "DELETE" });
      await reload();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="surface p-6">
      <h2 className="font-display text-xl text-slate2-900">Live location share</h2>
      <p className="mt-1 text-sm text-slate2-500">
        Generate a temporary link for one contact. Auto-expires; you can revoke at any time.
      </p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm">
          Duration (minutes)
          <input
            type="number" min={5} max={240} value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-1 input"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          Send link to email (optional)
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="mt-1 input" />
        </label>
        <button
          onClick={create}
          disabled={!signedIn || createBusy}
          className="sm:col-span-3 btn-primary disabled:opacity-50 disabled:cursor-wait"
        >
          {createBusy ? "Generating…" : "Generate link"}
        </button>
      </div>
      {!signedIn && (
        <p className="mt-3 text-xs text-slate2-500">Setting up your anonymous device session…</p>
      )}

      {lastShare && (
        <div className="mt-4 surface-muted p-4 text-sm">
          <div className="text-slate2-700">Share link (expires {new Date(lastShare.expiresAt).toLocaleString()})</div>
          <code className="block mt-1 break-all">{lastShare.shareUrl}</code>
        </div>
      )}

      {active.length > 0 && (
        <ul className="mt-4 divide-y divide-sand-200">
          {active.map((s) => (
            <li key={s.id} className="py-3 flex justify-between items-center text-sm">
              <span>Active until {new Date(s.expiresAt).toLocaleString()}</span>
              <button
                onClick={() => revoke(s.id)}
                disabled={revokingId === s.id}
                className="text-dusk-700 underline disabled:opacity-60 disabled:cursor-wait"
              >
                {revokingId === s.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
