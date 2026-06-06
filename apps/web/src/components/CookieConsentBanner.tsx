"use client";
import { useEffect, useState } from "react";

// v92 — minimal CCPA + GDPR / ePrivacy cookie banner. Only renders when
// NEXT_PUBLIC_ADSENSE_CLIENT_ID is configured (i.e., the deploy has
// opted into AdSense, which drops profiling cookies). Default
// deployments have no third-party advertising → no banner → no
// consent flow required.
//
// Choice persists to localStorage under `cs.consent.v1`. Until the user
// picks, AdSense personalization is requested in non-personalized mode
// via the public meta tag <meta name="google-adsense-account">; once
// the user accepts, we set `_gpp` / `_gpc` flags so AdSense knows to
// run in personalized mode. (Implementation in layout.tsx reads the
// flag at mount time.)
const KEY = "cs.consent.v1";

type Choice = "accept" | "reject" | null;

function readChoice(): Choice {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(KEY);
  if (v === "accept" || v === "reject") return v;
  return null;
}

export function CookieConsentBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (readChoice() === null) setShow(true);
  }, []);
  if (!show) return null;
  function decide(choice: "accept" | "reject") {
    try { window.localStorage.setItem(KEY, choice); } catch {}
    // Notify same-tab listeners (storage events only fire cross-tab) so the
    // consent-gated AdSense loader reacts immediately without a reload.
    try { window.dispatchEvent(new CustomEvent("cs-consent-change", { detail: choice })); } catch {}
    setShow(false);
  }
  return (
    <div
      role="dialog"
      aria-label="Cookie and tracking preferences"
      className="fixed bottom-0 inset-x-0 z-[1400] surface bg-white border-t border-sand-300 shadow-lg"
    >
      <div className="max-w-4xl mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="flex-1 text-xs sm:text-sm text-slate2-700 leading-snug">
          We use third-party advertising cookies for measurement. CommunitySafe never sells your personal information.
          See our <a href="/privacy" className="text-bay-700 hover:underline">Privacy Policy</a>.
          You can change this anytime in <a href="/settings/privacy" className="text-bay-700 hover:underline">Privacy Settings</a>.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => decide("reject")}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide("accept")}
            className="btn-primary text-xs px-3 py-1.5"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
