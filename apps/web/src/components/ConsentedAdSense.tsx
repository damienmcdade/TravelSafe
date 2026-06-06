"use client";
import { useEffect, useState } from "react";
import Script from "next/script";

const CONSENT_KEY = "cs.consent.v1";

function readConsent(): "accept" | "reject" | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "accept" || v === "reject" ? v : null;
  } catch {
    return null;
  }
}

/// fix(audit ads-consent-gate): the AdSense loader previously rendered in the
/// server layout and was injected regardless of the user's cookie-consent choice
/// — a prior-consent (ePrivacy/GDPR) gap for EU/UK/Swiss users, since the banner
/// promised "non-personalized until you choose." This client gate loads the
/// adsbygoogle script ONLY after the user has explicitly accepted, and reacts to
/// consent changes (the Privacy Settings reset) without a reload. Until consent
/// is "accept", no ad script is requested at all. (Latent today: ads are off
/// unless NEXT_PUBLIC_ADSENSE_CLIENT_ID is set, which the caller already guards.)
export function ConsentedAdSense({ clientId }: { clientId: string }) {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const sync = () => setConsented(readConsent() === "accept");
    sync();
    // Cross-tab + same-tab consent changes. The banner/settings dispatch a
    // storage event on write; we also poll once on focus as a belt-and-suspenders.
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("cs-consent-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("cs-consent-change", sync);
    };
  }, []);

  if (!consented) return null;

  return (
    <Script
      id="adsense-auto-ads"
      async
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
      crossOrigin="anonymous"
    />
  );
}
