import type { Metadata } from "next";

// fix(audit privacy/seo): the moderator queue is a privileged internal surface;
// keep it out of search indexes with an authoritative per-page noindex (not just
// the advisory robots.txt Disallow).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ModerationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
