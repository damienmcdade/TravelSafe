import type { Metadata } from "next";

// fix(audit privacy/seo): a live-location share URL must never be indexed.
// robots.txt Disallow is advisory; a per-page noindex/nofollow is the
// authoritative signal, so a leaked share-token link can't surface in search.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
