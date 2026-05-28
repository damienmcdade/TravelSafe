"use client";
import { useEffect, useRef, useState } from "react";

// v93p2 — COPPA affirmative-defense interstitial. Privacy policy
// already declares the service is not directed to children under 13,
// but COPPA §312.5 requires a "verifiable" age check to claim the
// affirmative defense if a parent complains. This single-screen
// gate captures the acknowledgement and persists it locally so
// returning users aren't re-prompted.
//
// Choice is stored in localStorage under `cs.age.v1`. If the user
// chooses "Under 13" we redirect to the privacy policy with an
// explanation rather than letting them proceed. This is deliberately
// a soft gate (not server-side verification) — it provides the
// affirmative-defense paper trail the FTC has accepted from similar
// general-audience services.
const KEY = "cs.age.v1";

type Choice = "ok" | "under13" | null;

function readChoice(): Choice {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  if (v === "ok" || v === "under13") return v;
  return null;
}

export function AgeGate() {
  const [show, setShow] = useState(false);
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const under13Ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (readChoice() === null) setShow(true); }, []);

  // v96 — focus management. When the dialog opens, focus moves to the
  // primary action (the "I'm 13 or older" button). Tab loops between
  // the two buttons (focus trap). On dismissal the prior focus is
  // restored.
  useEffect(() => {
    if (!show) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    acceptRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusables = [acceptRef.current, under13Ref.current].filter(Boolean) as HTMLElement[];
      if (focusables.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? focusables.indexOf(active) : -1;
      const nextIdx = e.shiftKey
        ? (idx <= 0 ? focusables.length - 1 : idx - 1)
        : (idx === focusables.length - 1 ? 0 : idx + 1);
      e.preventDefault();
      focusables[nextIdx].focus();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [show]);

  if (!show) return null;
  function accept() {
    try { window.localStorage.setItem(KEY, "ok"); } catch {}
    setShow(false);
  }
  function under13() {
    try { window.localStorage.setItem(KEY, "under13"); } catch {}
    window.location.href = "/privacy#children";
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Age verification"
      className="fixed inset-0 z-[2000] bg-slate2-900/70 flex items-center justify-center p-4"
    >
      <div className="surface bg-white max-w-md w-full p-6 space-y-4 animate-pop-in">
        <h2 className="font-display text-xl text-slate2-900">Confirm your age</h2>
        <p className="text-sm text-slate2-700 leading-relaxed">
          TravelSafe is built for adults to understand neighborhood safety
          in their city. It is not intended for children under 13. To continue,
          please confirm you&apos;re at least 13 years old.
        </p>
        <p className="text-xs text-slate2-500 leading-relaxed">
          We use this answer only to comply with the U.S. Children&apos;s Online
          Privacy Protection Act. We never store the answer on our servers,
          only in your browser.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            ref={acceptRef}
            onClick={accept}
            className="btn-primary flex-1 px-4 py-2 text-sm"
          >
            I&apos;m 13 or older
          </button>
          <button
            type="button"
            ref={under13Ref}
            onClick={under13}
            className="btn-secondary flex-1 px-4 py-2 text-sm"
          >
            I&apos;m under 13
          </button>
        </div>
      </div>
    </div>
  );
}
