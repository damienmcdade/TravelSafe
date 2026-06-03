"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api-client";

// v64 — extracted from /onboarding/trusted-contacts/page.tsx so the
// same UI works inside the Check-on-me panel. The user asked for
// trusted-contacts add to be reachable without leaving the personal-
// safety tab (one less navigation hop when arming a timer). Both the
// onboarding flow and the in-panel surface render the same component
// so they stay in lockstep when the contact API or copy changes.

interface Contact {
  id: string;
  label: string;
  email: string | null;
  phone: string | null;
  status: "PENDING" | "CONFIRMED" | "REVOKED";
}

interface Props {
  /// Collapsed presentation skips the introductory copy and shrinks
  /// padding so the manager fits inside another card (e.g. CheckInPanel).
  /// Default false renders the full standalone panel.
  embedded?: boolean;
}

export function TrustedContactsManager({ embedded = false }: Props) {
  const { data, reload } = useApi<Contact[]>("/contacts");
  // fix(audit safety-sms-unconfigured-2): when SMS isn't configured, phone-only
  // contacts are never alerted — surface that honestly.
  const { data: caps } = useApi<{ sms: boolean }>("/config/capabilities");
  const smsConfigured = caps?.sms !== false; // default optimistic until loaded
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // fix(audit loc-consent-bypass-1): explicit permission attestation before a
  // contact (who will receive safety/SOS notifications) can be added.
  const [permission, setPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const contacts = data ?? [];
  const atLimit = contacts.length >= 5;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email && !phone) {
      setError("Add an email or a phone — at least one is required.");
      return;
    }
    if (!permission) {
      setError("Please confirm you have this person's permission to add them.");
      return;
    }
    setBusy(true);
    try {
      await api("/contacts", {
        method: "POST",
        body: JSON.stringify({ label, email: email || null, phone: phone || null, permissionAcknowledged: permission }),
      });
      setLabel(""); setEmail(""); setPhone(""); setPermission(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // fix(audit ui-cards-1): Remove and Resend silently swallowed failures (no
  // catch), so a failed delete/resend looked like it worked. Surface the error.
  async function remove(id: string) {
    setError(null);
    try {
      await api(`/contacts/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(`Couldn't remove that contact — ${(err as Error).message}. Try again.`);
    }
  }

  async function resend(id: string) {
    setError(null);
    try {
      await api(`/contacts/${id}/resend`, { method: "POST" });
      await reload();
    } catch (err) {
      setError(`Couldn't resend the confirmation — ${(err as Error).message}. Try again.`);
    }
  }

  const wrapClass = embedded ? "" : "surface p-6";
  return (
    <div className={wrapClass}>
      {!embedded && (
        <>
          <h2 className="font-display text-lg text-slate2-900">Trusted contacts</h2>
          <p className="text-xs text-slate2-500 mt-1">
            Up to 5 people. They get an opt-in email; only confirmed contacts are notified when a timer expires or you share a live location.
          </p>
        </>
      )}

      {contacts.length > 0 && (
        <ul className={`${embedded ? "" : "mt-3"} divide-y divide-sand-200`}>
          {contacts.map((c) => (
            <li key={c.id} className="py-2 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <div className="text-sm text-slate2-900 truncate">{c.label}</div>
                <div className="text-xs text-slate2-500 truncate">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs shrink-0">
                {c.status === "CONFIRMED" ? (
                  <span className="px-2 py-0.5 rounded-full bg-sage-200 text-sage-700">Confirmed</span>
                ) : (
                  <>
                    <span className="px-2 py-0.5 rounded-full bg-amber2-200 text-amber2-700">Pending</span>
                    <button onClick={() => resend(c.id)} className="text-slate2-700 underline">Resend</button>
                  </>
                )}
                <button onClick={() => remove(c.id)} className="text-dusk-700 underline">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* fix(audit safety-sms-unconfigured-2): honest warning when SMS delivery
          isn't configured — phone-only contacts can't be alerted. */}
      {!smsConfigured && (
        <p role="status" className="mt-3 rounded-md bg-amber2-100 px-3 py-2 text-xs text-amber2-800">
          SMS alerts aren&apos;t enabled on this deployment. Contacts with only a phone
          number won&apos;t be notified — add an email address so they can be reached.
        </p>
      )}

      {/* v96 — added visible label elements via htmlFor (sr-only so the
          visual layout is unchanged) per the a11y audit. Aria-labels
          alone don't reliably register with mobile voice-input or
          some screen-reader configurations; explicit <label htmlFor>
          pairing fixes WCAG 1.3.1 + 3.3.2 conformance. */}
      <form
        className={`${embedded || contacts.length > 0 ? "mt-3" : ""} grid grid-cols-1 sm:grid-cols-3 gap-2`}
        onSubmit={add}
      >
        <div>
          <label htmlFor="tc-label" className="sr-only">Contact label, for example Roommate</label>
          <input
            id="tc-label"
            required disabled={atLimit || busy}
            placeholder="Label (e.g. Roommate)"
            value={label} onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 surface text-sm"
          />
        </div>
        <div>
          <label htmlFor="tc-email" className="sr-only">Contact email address</label>
          <input
            id="tc-email"
            disabled={atLimit || busy}
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 surface text-sm"
          />
        </div>
        <div>
          <label htmlFor="tc-phone" className="sr-only">Contact phone number</label>
          <input
            id="tc-phone"
            disabled={atLimit || busy}
            type="tel"
            autoComplete="tel"
            placeholder="Phone"
            value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 surface text-sm"
          />
        </div>
        <label className="sm:col-span-3 flex items-start gap-2 text-xs text-slate2-600">
          <input
            id="tc-permission"
            type="checkbox"
            disabled={atLimit || busy}
            checked={permission}
            onChange={(e) => setPermission(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I confirm this person has agreed to be my trusted contact and to receive
            check-in, Live Share, and SOS notifications from me.
          </span>
        </label>
        <button
          type="submit" disabled={atLimit || busy || !permission}
          className="sm:col-span-3 btn-secondary text-sm disabled:opacity-50"
        >
          {busy ? "Sending…" : atLimit ? "Limit reached (5)" : "Add contact (send confirmation)"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-dusk-700">{error}</p>}
    </div>
  );
}
