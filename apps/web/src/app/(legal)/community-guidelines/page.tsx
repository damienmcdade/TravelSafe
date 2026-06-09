import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Community Guidelines",
  description:
    "The rules for posting in CommunitySafe — what belongs in the community feed, what's not allowed, how moderation works, and how to report content.",
};

const LAST_UPDATED = "2026-06-09";

export default function CommunityGuidelinesPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Community</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">Community guidelines</h1>
        <p className="mt-2 text-xs text-slate2-500">Last updated: {LAST_UPDATED}</p>
        <p className="mt-3 text-sm text-slate2-700 leading-relaxed">
          The CommunitySafe community feed is for sharing timely, factual,
          neighborhood-level safety information with your neighbors. These
          guidelines explain what belongs here, what doesn&apos;t, and how
          moderation works. They are part of, and read together with, our{" "}
          <Link href="/terms" className="text-bay-700 hover:underline">Terms of use</Link>.
        </p>
      </header>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What belongs here</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>First-hand, recent observations relevant to neighborhood safety (a hazard, an ongoing situation, a heads-up for neighbors).</li>
          <li>Factual descriptions of what you saw or experienced, to the best of your knowledge.</li>
          <li>Locations described by landmark, block, or area — not a specific home address.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">What&apos;s not allowed</h2>
        <p>To keep the feed useful and lawful, an automated pre-vetter and human review will block or remove posts that include:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Profiling people by appearance</strong> — descriptions that single out a person by race, ethnicity, perceived religion, or similar characteristics. Report behavior, not identity.</li>
          <li><strong>Personal information about others</strong> — a specific street address below the block level, a vehicle license plate, a phone number, or the name of a private individual.</li>
          <li><strong>Threats, harassment, or incitement</strong> — threats of violence, calls to confront or harm anyone, or content that encourages vigilante action.</li>
          <li><strong>Slurs, hate speech, or profanity</strong> directed at a person or group.</li>
          <li><strong>Accusations of crime against a named or identifiable person.</strong> Describe events; do not declare someone guilty.</li>
          <li><strong>Misinformation</strong> you know or suspect to be false, spam, advertising, or content you don&apos;t have the right to share.</li>
        </ul>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Use the feed responsibly</h2>
        <p>CommunitySafe is an awareness tool, not an emergency service. In an emergency, call 911 — the app does not contact emergency services on your behalf. Do not use the feed to surveil, track, confront, follow, or film anyone, and do not use posts or any data from the app for housing, lending, insurance, or employment decisions (see the prohibited-use section of the <Link href="/terms" className="text-bay-700 hover:underline">Terms</Link>).</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">How moderation works</h2>
        <p>Every post is screened by an automated pre-vetter before it goes live; posts that contain the content listed above are blocked at submission. Posts that pass can still be reported by other users and reviewed. Edits to your own posts are kept in an append-only history so moderation context is preserved.</p>
        <p>Repeated rejected posts, repeated upheld reports against you, or any attempt to abuse the moderation system can result in a temporary suspension and, for severe or repeated violations, a permanent ban from posting. Moderation is applied in good faith to keep the community safe and is not a guarantee that every post is accurate — treat posts as neighbor reports, not verified facts.</p>
      </section>

      <section className="surface p-6 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-xl text-slate2-900">Reporting &amp; takedowns</h2>
        <p>If you see a post that breaks these guidelines, use the report control on the post and our reviewers will assess it. For copyright concerns, see our <Link href="/dmca" className="text-bay-700 hover:underline">Copyright / DMCA</Link> page. By posting, you confirm your content is factual to the best of your knowledge and that you have the right to share it.</p>
      </section>

      <LegalFooter />
    </main>
  );
}
