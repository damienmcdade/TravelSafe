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
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
    setBusy(true);
    try {
      await api("/contacts", {
        method: "POST",
        body: JSON.stringify({ label, email: email || null, phone: phone || null }),
      });
      setLabel(""); setEmail(""); setPhone("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/contacts/${id}`, { method: "DELETE" });
    await reload();
  }

  async function resend(id: string) {
    await api(`/contacts/${id}/resend`, { method: "POST" });
    await reload();
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

      <form
        className={`${embedded || contacts.length > 0 ? "mt-3" : ""} grid grid-cols-1 sm:grid-cols-3 gap-2`}
        onSubmit={add}
      >
        <input
          required disabled={atLimit || busy}
          placeholder="Label (e.g. Roommate)"
          value={label} onChange={(e) => setLabel(e.target.value)}
          className="px-3 py-2 surface text-sm"
        />
        <input
          disabled={atLimit || busy}
          type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="px-3 py-2 surface text-sm"
        />
        <input
          disabled={atLimit || busy}
          placeholder="Phone"
          value={phone} onChange={(e) => setPhone(e.target.value)}
          className="px-3 py-2 surface text-sm"
        />
        <button
          type="submit" disabled={atLimit || busy}
          className="sm:col-span-3 btn-secondary text-sm disabled:opacity-50"
        >
          {busy ? "Sending…" : atLimit ? "Limit reached (5)" : "Add contact (send confirmation)"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-dusk-700">{error}</p>}
    </div>
  );
}
