import Link from "next/link";

/// Shared footer for the standalone legal / public pages (privacy, terms,
/// about, methodology, credits, pricing). These pages live OUTSIDE the (app)
/// shell, so they don't inherit the authenticated app footer — this component
/// gives every legal surface the same operator disclosure (CyberWave Technologies LLC),
/// copyright line, contact email, and cross-links, so the responsible legal
/// entity + its site + contact are always present.
export function LegalFooter() {
  return (
    <footer className="mt-8 border-t border-sand-200 pt-4 text-center text-xs text-slate2-500 space-y-2">
      {/* Content nav — surfaces the crawlable city/coverage pages from every
          public surface so the rich content is reachable in one click from any
          entry point (the homepage included). A clear navigational path to the
          substantive content is part of AdSense's "good user experience" bar. */}
      <nav aria-label="Browse" className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <Link href="/cities" className="text-bay-700 hover:underline">All cities</Link>
        <Link href="/coverage" className="text-bay-700 hover:underline">Coverage &amp; status</Link>
        <Link href="/map" className="text-bay-700 hover:underline">Crime map</Link>
        <Link href="/community" className="text-bay-700 hover:underline">Community</Link>
      </nav>
      <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <Link href="/about" className="text-bay-700 hover:underline">About</Link>
        <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link>
        <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link>
        <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>
        <Link href="/community-guidelines" className="text-bay-700 hover:underline">Community guidelines</Link>
        <Link href="/accessibility" className="text-bay-700 hover:underline">Accessibility</Link>
        <Link href="/dmca" className="text-bay-700 hover:underline">Copyright / DMCA</Link>
        <Link href="/credits" className="text-bay-700 hover:underline">Photo credits</Link>
      </nav>
      <p>
        © {new Date().getFullYear()} CyberWave Technologies LLC — operator of CommunitySafe. All rights reserved.{" "}
        <a href="https://cyberwaveglobal.com" target="_blank" rel="noopener noreferrer" className="text-bay-700 hover:underline">cyberwaveglobal.com</a>
        {" · "}
        <a href="mailto:info@cyberwaveglobal.com" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a>
      </p>
      {/* fix(audit legal-trademark-no-mark-1): explicit brand-ownership / mark
          assertion so the entity -> mark -> product chain is stated. */}
      <p>CommunitySafe™ is a trademark of CyberWave Technologies LLC.</p>
    </footer>
  );
}
