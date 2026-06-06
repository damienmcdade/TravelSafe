"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useAnonymousAuth, useApi, getStoredToken } from "@/lib/api-client";
import { requestLocation } from "@/lib/geolocation";
import { SafetyTipsPanel } from "@/components/SafetyTipsPanel";
import { TrustedContactsManager } from "@/components/TrustedContactsManager";
import { SavedPlacesPanel } from "@/components/SavedPlacesPanel";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { registryForState } from "@/lib/state-registries";

// v64 — shared shape for the contact-picker that's now embedded in
// both Check-on-me and Live-share. Keep loose (only the fields we
// actually display) so the API endpoint can evolve without breaking
// the picker.
interface TrustedContact {
  id: string;
  label: string;
  email: string | null;
  phone: string | null;
  status: "PENDING" | "CONFIRMED" | "REVOKED";
}

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

export default function PersonalSafetyPage() {
  const { city } = useCity();
  // Globally-shared neighborhood selection — Personal Safety follows the
  // same area the user picked elsewhere (Neighborhood Awareness wheel
  // picker, City Awareness hotspot click, header city pill, or "Use
  // my location"). No inline picker here — single area selector per
  // session lives in one canonical place.
  const { area } = useArea(city.slug);
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
            CommunitySafe&apos;s personal-safety tools may fail due to network, device, or service issues
            and are <strong>not a substitute for 911 or professional emergency services</strong>.
            The application does not contact emergency services on your behalf. In an emergency, call 911.
          </p>
          <button onClick={dismissDisclaimer} className="mt-3 px-3 py-1.5 bg-slate2-900 text-sand-50 rounded-xl text-sm">
            I understand
          </button>
        </div>
      )}

      {/* v64 — Check-on-me lives at the top of the tab; Live share
          sits directly under it. These are the most-used action
          surfaces, so they shouldn't be buried below tips or the
          emergency dial. The emergency panel, safety tips, and
          registry/account follow below. */}
      <SosPanel />
      <SavedPlacesPanel />
      <CheckInPanel />
      <LiveSharePanel />

      <EmergencyPanel />

      <section className="surface p-5">
        <h2 className="font-display text-lg text-slate2-900">Tailor safety tips to your area</h2>
        <p className="mt-1 text-xs text-slate2-500">
          Tips below are matched to the offenses most commonly reported in {area ? area.label : city.label}. To switch region, use the city + neighborhood selector in the header.
        </p>
      </section>

      <SafetyTipsPanel
        areaSlug={area?.slug}
        jurisdictionSlug={!area ? city.slug : undefined}
      />

      {/* Official registries — moved here from Connections (former
          CommunitySafe) per v7 directive. Lookup is a personal-safety
          tool, lives on a personal-safety surface. We never re-host
          or render individuals; this is a deep link out to the
          official state registry. */}
      <OfficialRegistryCard />


      <AccountPanel />
    </main>
  );
}

/// Per-state sex-offender registry link. Picks the registry URL
/// matching the user's currently-selected city's state. CA users
/// see California's Megan's Law site; IL users see Illinois ISP's
/// SOR; etc. Cities in states without an explicit entry get the
/// federal NSOPW aggregator. Resolves the prior bug where every
/// city — including out-of-state ones — surfaced California's link.
function OfficialRegistryCard() {
  const { city } = useCity();
  const registry = registryForState(city.state);
  return (
    <section className="surface p-5 border-amber2-500/30">
      <h2 className="font-display text-lg text-slate2-900">Official registries</h2>
      <p className="mt-1 text-sm text-slate2-700">
        For sex-offender information, CommunitySafe links to the official public registry for {city.state}. We do not re-host or display individuals here.
      </p>
      <a href={registry.url} target="_blank" rel="noreferrer" className="mt-3 inline-block underline text-slate2-900 hover:text-bay-700 transition-colors">
        Open {registry.label} →
      </a>
    </section>
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
      // fix(audit pentest-authn-4): authenticate via the HttpOnly session cookie
      // (sent automatically with credentials:include); fall back to a legacy
      // localStorage Bearer only while migrating. This is a blob download so it
      // can't use the api() wrapper.
      const legacy = getStoredToken();
      const res = await fetch("/api/account/export", {
        credentials: "include",
        headers: legacy ? { Authorization: `Bearer ${legacy}` } : undefined,
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // fix(audit legal-brand-1/ui-brand-split): user-facing download must carry
      // the public brand (CommunitySafe), not the internal "travelsafe" name.
      a.download = `communitysafe-account-${new Date().toISOString().slice(0, 10)}.json`;
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
          Your account and all associated data have been removed from CommunitySafe&apos;s servers. Returning to home…
        </p>
      </section>
    );
  }

  return (
    <section className="surface p-6">
      <h2 className="font-display text-xl text-slate2-900">Your account &amp; data</h2>
      <p className="mt-1 text-sm text-slate2-700">
        CommunitySafe stores a session for your device so check-ins, contacts, and posts can be associated with you. Below are the controls the <a href="/privacy" className="text-bay-700 hover:underline">privacy policy</a> describes.
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
        it does not route through CommunitySafe&apos;s servers and works even if the app backend is down.
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

// v64 — shared contact-picker used by Check-on-me + Live-share.
// "Send to all confirmed" is the default; selecting individual
// contacts narrows the set. Pending / revoked contacts are
// rendered disabled with the reason so users understand why a
// contact won't get the notification.
function ContactPicker({
  contacts,
  selectedIds,
  setSelectedIds,
  sendToAll,
  setSendToAll,
  label,
}: {
  contacts: TrustedContact[];
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  sendToAll: boolean;
  setSendToAll: (b: boolean) => void;
  label: string;
}) {
  const confirmed = contacts.filter((c) => c.status === "CONFIRMED");
  if (confirmed.length === 0) {
    return (
      <div className="text-xs text-slate2-500 surface-muted p-3 rounded-lg">
        {label} No confirmed contacts yet — add one below to enable this.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-slate2-500">{label}</div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sendToAll}
          onChange={(e) => setSendToAll(e.target.checked)}
        />
        Send to all confirmed ({confirmed.length})
      </label>
      {!sendToAll && (
        <ul className="space-y-1 pl-4">
          {confirmed.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(c.id); else next.delete(c.id);
                    setSelectedIds(next);
                  }}
                />
                <span>{c.label}</span>
                <span className="text-xs text-slate2-500">
                  {[c.email, c.phone].filter(Boolean).join(" · ")}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SosResult {
  shareUrl: string;
  expiresAt: string;
  mapUrl: string | null;
  contactsNotified: number;
  receipts: { contactLabel: string; channel: string; status: string }[];
}

// One-tap SOS / panic — the "alert the people who care about me, right now"
// action. Two-tap confirm prevents accidental fires. Always points at 911 for
// true emergencies; this is the trusted-contact layer, not a 911 dialer.
function SosPanel() {
  const { ready: signedIn } = useAnonymousAuth();
  const { data: contactsData } = useApi<TrustedContact[]>(signedIn ? "/contacts" : null, [signedIn]);
  const confirmed = useMemo(() => (contactsData ?? []).filter((c) => c.status === "CONFIRMED"), [contactsData]);
  const [armed, setArmed] = useState(false); // second-tap confirm state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SosResult | null>(null);

  // Auto-disarm the confirm state after 4s so a stray first tap doesn't linger.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      let lat: number | undefined, lng: number | undefined;
      try {
        const pos = await requestLocation();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        // best-effort — SOS still fires without a location pin.
      }
      const r = await api<SosResult>("/safety/sos", { method: "POST", body: JSON.stringify({ lat, lng }) });
      setResult(r);
      setArmed(false);
    } catch (err) {
      setError(`Could not send SOS — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface p-6 border-2" style={{ borderColor: "#DC2626" }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl text-slate2-900">🚨 Send SOS</h2>
        <a href={`tel:${EMERGENCY_DIAL}`} className="text-xs font-medium text-coral-700 hover:underline">
          True emergency? Call {EMERGENCY_DIAL}
        </a>
      </div>
      <p className="mt-1 text-sm text-slate2-600">
        One tap alerts <strong>every confirmed trusted contact</strong> right now with an urgent
        message, a live-location link, and a map pin of where you are. This does <strong>not</strong> call
        911 — use it to reach the people who care about you fast.
      </p>

      {!signedIn ? (
        <p className="mt-3 text-sm text-slate2-500">Sign in to use SOS — it notifies your trusted contacts.</p>
      ) : result ? (
        <div className="mt-4 rounded-xl bg-sage-50 border border-sage-300 p-4" role="status" aria-live="assertive">
          <p className="text-sm font-medium text-sage-800">
            SOS sent — {result.contactsNotified} contact{result.contactsNotified === 1 ? "" : "s"} alerted.
          </p>
          <ul className="mt-2 text-xs text-slate2-600 space-y-0.5">
            {result.receipts.map((r, i) => (
              <li key={i}>
                {r.contactLabel}: {r.channel} · {r.status === "sent" ? "✓ delivered" : `⚠ ${r.status}`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate2-500">
            Live link active until {new Date(result.expiresAt).toLocaleTimeString()}.{" "}
            <a href={result.shareUrl} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">Open share page</a>.
          </p>
          <button onClick={() => setResult(null)} className="mt-3 text-xs text-slate2-600 hover:underline">
            Done
          </button>
        </div>
      ) : confirmed.length === 0 ? (
        <p className="mt-3 text-sm text-amber2-700">
          Add and confirm at least one trusted contact below before you can send an SOS.
        </p>
      ) : (
        <div className="mt-4">
          <button
            onClick={() => (armed ? fire() : setArmed(true))}
            disabled={busy}
            className="w-full py-4 rounded-2xl text-white font-display text-lg tracking-wide disabled:opacity-60 transition-transform active:scale-[0.98]"
            style={{ background: armed ? "#991B1B" : "#DC2626" }}
            aria-live="polite"
          >
            {busy ? "Sending SOS…" : armed ? `Tap again to confirm — alerts ${confirmed.length} contact${confirmed.length === 1 ? "" : "s"}` : "Send SOS"}
          </button>
          {armed && !busy && (
            <button onClick={() => setArmed(false)} className="mt-2 w-full text-xs text-slate2-500 hover:underline">
              Cancel
            </button>
          )}
          {error && <p className="mt-2 text-xs text-coral-700">{error}</p>}
        </div>
      )}
    </section>
  );
}

function CheckInPanel() {
  const { ready: signedIn } = useAnonymousAuth();
  const { data, reload } = useApi<ActiveTimer[]>(signedIn ? "/safety/check-in/active" : null, [signedIn]);
  const active = data?.[0] ?? null;
  // v64 — pull contacts so we can both surface the "who will be
  // notified" picker on this card AND render the embedded contacts
  // manager directly below the arm button. One less navigation hop.
  const { data: contactsData, reload: reloadContacts } = useApi<TrustedContact[]>(signedIn ? "/contacts" : null, [signedIn]);
  const contacts = useMemo(() => contactsData ?? [], [contactsData]);

  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sendToAll, setSendToAll] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      // v64 — pass the contact-target scope to the server. The
      // server-side check-in worker reads this when the timer expires;
      // unset = notify every confirmed contact (legacy behavior),
      // contactIds = notify only the selected ones. The API is
      // back-compat: missing field keeps the prior "all confirmed"
      // semantics.
      const contactIds = sendToAll ? undefined : Array.from(selectedIds);
      await api("/safety/check-in", {
        method: "POST",
        body: JSON.stringify({ durationMinutes: duration, message: note || undefined, lat, lng, contactIds }),
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
          <div className="sm:col-span-3">
            <ContactPicker
              contacts={contacts}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              sendToAll={sendToAll}
              setSendToAll={setSendToAll}
              label="Notify if I don't check in:"
            />
          </div>
          {/* fix(audit safety-checkin-zero-contacts-6): arming a check-in with no
              confirmed contacts notifies NOBODY when it expires — a dangerous
              silent failure for a safety feature. The API allows it (personal
              reminder), but the consequence must be unmissable before arming. */}
          {contacts.filter((c) => c.status === "CONFIRMED").length === 0 && (
            <p className="sm:col-span-3 surface bg-amber2-50 border border-amber2-200 p-3 text-xs text-amber2-700" role="alert">
              ⚠ You have no confirmed trusted contacts, so if this timer expires <strong>no one will be notified</strong>. Add and confirm a contact below to be alerted on your behalf — until then this is only a personal reminder.
            </p>
          )}
          <button
            onClick={arm}
            disabled={busy || (!sendToAll && selectedIds.size === 0 && contacts.some((c) => c.status === "CONFIRMED"))}
            className="sm:col-span-3 btn-primary disabled:opacity-50"
          >
            {busy ? "Arming…" : "Arm timer"}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-dusk-700">{error}</p>}
      {!signedIn && (
        <p className="mt-3 text-xs text-slate2-500">Setting up your anonymous device session…</p>
      )}

      {/* v64 — trusted contacts embedded directly inside Check-on-me.
          The user asked for the add UI to be available without
          navigating away. Reloads the contacts list above when an add
          succeeds so the picker reflects the new contact immediately
          (once they confirm via email). */}
      {signedIn && (
        <div className="mt-5 pt-4 border-t border-sand-200">
          <h3 className="font-display text-sm text-slate2-900 mb-2">Trusted contacts</h3>
          <p className="text-xs text-slate2-500 mb-3">
            Pending contacts need to confirm via email before they can be notified.
          </p>
          <div onClick={() => { void reloadContacts(); }}>
            <TrustedContactsManager embedded />
          </div>
        </div>
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
  const { data: contactsData } = useApi<TrustedContact[]>(signedIn ? "/contacts" : null, [signedIn]);
  const contacts = useMemo(() => contactsData ?? [], [contactsData]);

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
  const [contact, setContact] = useState("");
  // v64 — multi-recipient via trusted contacts list. The user can
  // either type a one-off recipient (the legacy single-contact path)
  // OR pick from trusted contacts (loops one create per contact and
  // aggregates delivery results into batchResult).
  const [sendToAll, setSendToAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastShare, setLastShare] = useState<{ shareUrl: string; expiresAt: string; delivery?: { kind: "email" | "phone" | null; sent: boolean; reason?: string } } | null>(null);
  const [batchResult, setBatchResult] = useState<Array<{ label: string; sent: boolean; reason?: string }> | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // v113 — while ANY Live Share is active, stream this device's position to the
  // heartbeat endpoint so recipients follow live movement on the /share map. One
  // watch updates every active share (server fans out). Throttled to ~15s to stay
  // well under the /api/safety rate limit and to save battery.
  const hasActive = active.length > 0;
  useEffect(() => {
    if (!hasActive || typeof navigator === "undefined" || !navigator.geolocation) return;
    let lastSent = 0;
    const onPos = (pos: GeolocationPosition) => {
      const now = Date.now();
      if (now - lastSent < 15_000) return;
      lastSent = now;
      void api("/safety/live-share/heartbeat", {
        method: "POST",
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      }).catch(() => { /* best-effort; next position retries */ });
    };
    const id = navigator.geolocation.watchPosition(onPos, () => { /* permission denied / unavailable */ }, {
      enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000,
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [hasActive]);

  async function create() {
    if (!signedIn || createBusy) return;
    setCreateBusy(true);
    setBatchResult(null);
    try {
      const confirmed = contacts.filter((c) => c.status === "CONFIRMED");
      // Decide who to send to. Three modes:
      //   1. one-off contact typed into the field — single create
      //   2. picker: "send to all confirmed" → one create per contact
      //   3. picker: specific contacts selected → one create per selected
      // If both the field and the picker are populated we honor BOTH —
      // power-user case where you want to add an extra one-off ad-hoc.
      const pickerTargets: TrustedContact[] = sendToAll
        ? confirmed
        : confirmed.filter((c) => selectedIds.has(c.id));

      const recipients: string[] = [];
      if (contact.trim()) recipients.push(contact.trim());
      for (const t of pickerTargets) {
        const recip = t.email || t.phone;
        if (recip) recipients.push(recip);
      }

      if (recipients.length === 0) {
        // No recipients — generate a link only, no delivery attempt
        const r = await api<{ shareUrl: string; expiresAt: string; delivery?: { kind: "email" | "phone" | null; sent: boolean; reason?: string } }>("/safety/live-share", {
          method: "POST",
          body: JSON.stringify({ durationMinutes: duration }),
        });
        setLastShare(r);
        await reload();
        return;
      }

      // Issue one create call per recipient. The server generates one
      // share record per call (each recipient gets a unique URL with
      // its own revoke handle). Aggregate the per-recipient delivery
      // status into batchResult for the UI to summarize.
      const results = await Promise.allSettled(
        recipients.map((to, i) =>
          api<{ shareUrl: string; expiresAt: string; delivery?: { kind: "email" | "phone" | null; sent: boolean; reason?: string } }>(
            "/safety/live-share",
            { method: "POST", body: JSON.stringify({ durationMinutes: duration, contact: to }) },
          ).then((r) => ({ idx: i, to, r })),
        ),
      );

      const batch: Array<{ label: string; sent: boolean; reason?: string }> = [];
      let firstShare: typeof lastShare = null;
      for (let i = 0; i < results.length; i++) {
        const recip = recipients[i];
        const matchedContact = pickerTargets.find((t) => (t.email || t.phone) === recip);
        const label = matchedContact?.label ?? recip;
        const res = results[i];
        if (res.status === "fulfilled") {
          if (!firstShare) firstShare = res.value.r;
          batch.push({ label, sent: res.value.r.delivery?.sent ?? false, reason: res.value.r.delivery?.reason });
        } else {
          batch.push({ label, sent: false, reason: (res.reason as Error)?.message?.slice(0, 80) ?? "request_failed" });
        }
      }
      setLastShare(firstShare);
      setBatchResult(batch);
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
          One-off recipient (optional)
          <input
            type="text"
            inputMode="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="alice@example.com or +1 415 555 1212"
            className="mt-1 input"
          />
          <p className="mt-1 text-[11px] text-slate2-500">
            Email: SMTP · Phone: SMS via Twilio. Leave blank to use only the picker below.
          </p>
        </label>
        <div className="sm:col-span-3">
          <ContactPicker
            contacts={contacts}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            sendToAll={sendToAll}
            setSendToAll={setSendToAll}
            label="Or send to trusted contacts:"
          />
        </div>
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

      {batchResult && batchResult.length > 0 && (
        <div className="mt-4 surface-muted p-4 text-sm">
          <div className="font-medium text-slate2-700 mb-2">Delivery summary:</div>
          <ul className="space-y-1">
            {batchResult.map((b, i) => (
              <li key={i} className="text-xs flex items-center justify-between gap-2">
                <span className="truncate">{b.label}</span>
                {b.sent ? (
                  <span className="px-2 py-0.5 rounded-full bg-sage-200 text-sage-700">Sent</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber2-200 text-amber2-700">
                    Not sent{b.reason ? ` · ${b.reason}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastShare && (
        <div className="mt-4 surface-muted p-4 text-sm space-y-2">
          <div className="text-slate2-700">Share link (expires {new Date(lastShare.expiresAt).toLocaleString()})</div>
          <code className="block break-all">{lastShare.shareUrl}</code>
          {lastShare.delivery && lastShare.delivery.kind && (
            lastShare.delivery.sent ? (
              <p className="text-xs text-sage-700">
                ✓ Sent via {lastShare.delivery.kind === "email" ? "email" : "SMS"}.
              </p>
            ) : (
              <p className="text-xs text-amber2-700">
                Link saved but {lastShare.delivery.kind === "email" ? "email" : "SMS"} couldn&apos;t be sent
                {lastShare.delivery.reason === "smtp_not_configured" ? " — SMTP not configured on the server." :
                 lastShare.delivery.reason === "sms_not_configured" ? " — Twilio not configured on the server." :
                 lastShare.delivery.reason ? ` (${lastShare.delivery.reason}).` : "."} You can still copy the link above and share it manually.
              </p>
            )
          )}
          {lastShare.delivery && !lastShare.delivery.kind && lastShare.delivery.reason === "contact_not_recognized" && (
            <p className="text-xs text-amber2-700">
              Couldn&apos;t recognize the contact as an email or phone number. The link is saved — copy it manually above.
            </p>
          )}
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
