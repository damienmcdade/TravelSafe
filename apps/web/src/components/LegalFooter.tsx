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
      <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <Link href="/about" className="text-bay-700 hover:underline">About</Link>
        <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link>
        <Link href="/privacy" className="text-bay-700 hover:underline">Privacy</Link>
        <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>
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
    </footer>
  );
}
