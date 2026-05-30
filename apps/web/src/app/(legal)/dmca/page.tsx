import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Copyright / DMCA",
  description:
    "How to report copyright infringement on CommunitySafe under the DMCA — our designated agent, the notice requirements, counter-notices, and our repeat-infringer policy.",
};

const LAST_UPDATED = "2026-05-30";

export default function DmcaPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Legal</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Copyright &amp; DMCA</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Overview</h2>
        <p>CommunitySafe, operated by CyberWave Technologies LLC, respects the intellectual-property rights of others. Most content on the site is either public open-government data (cited inline) or CC-licensed imagery (see <Link href="/credits" className="text-bay-700 hover:underline">Photo credits</Link>). If you believe content on CommunitySafe — including a user-submitted community post — infringes your copyright, you can ask us to remove it under the Digital Millennium Copyright Act (DMCA), 17 U.S.C. § 512.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Designated agent</h2>
        <p>Send DMCA notices to our designated copyright agent:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>CyberWave Technologies LLC — DMCA Agent</li>
          <li>Email: <a href="mailto:info@cyberwaveglobal.com?subject=DMCA%20notice" className="text-bay-700 hover:underline">info@cyberwaveglobal.com</a> (put &ldquo;DMCA&rdquo; in the subject)</li>
          <li><a href="https://cyberwaveglobal.com" target="_blank" rel="noopener noreferrer" className="text-bay-700 hover:underline">cyberwaveglobal.com</a></li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What your notice must include</h2>
        <p>A valid takedown notice under § 512(c)(3) must include:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your physical or electronic signature.</li>
          <li>Identification of the copyrighted work you claim is infringed.</li>
          <li>Identification of the material you say is infringing, with enough detail (e.g. the page URL) for us to locate it.</li>
          <li>Your name, address, telephone number, and email.</li>
          <li>A statement that you have a good-faith belief the use is not authorized by the copyright owner, its agent, or the law.</li>
          <li>A statement, under penalty of perjury, that the information is accurate and that you are the owner or authorized to act on the owner&rsquo;s behalf.</li>
        </ul>
        <p className="text-xs text-slate2-500">Note: knowingly making a material misrepresentation in a DMCA notice can make you liable for damages under § 512(f).</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Counter-notice</h2>
        <p>If your content was removed and you believe that was a mistake or misidentification, you may send a counter-notice to the same agent including: your signature; identification of the removed material and where it appeared; a statement under penalty of perjury that you have a good-faith belief it was removed by mistake; and your name, address, phone, and consent to the jurisdiction of the federal court for your district (or, if outside the US, the Central District of California).</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Repeat infringers</h2>
        <p>Consistent with our <Link href="/terms" className="text-bay-700 hover:underline">Terms of Use</Link> and the community-post moderation policy, we will, in appropriate circumstances, suspend or terminate the posting access of users who are repeat infringers.</p>
      </section>

      <LegalFooter />
    </main>
  );
}
