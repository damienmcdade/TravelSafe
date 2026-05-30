// v99 — Server Component. The page shell renders on the server; the
// interactive TrustedContactsManager below is its own client island.
import Link from "next/link";
import { TrustedContactsManager } from "@/components/TrustedContactsManager";

// v64 — migrated to the shared TrustedContactsManager component so
// this onboarding flow and the in-Check-on-me embed stay in lockstep.
// Previously, copy / behavior tweaks only landed in one place.
export default function TrustedContactsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="font-display text-3xl text-slate2-900">Trusted contacts (optional)</h1>
      <p className="mt-2 text-slate2-500">
        Add up to 5 people. They receive an opt-in email; only after they confirm will they
        be notified when a check-in timer expires or you share a live location with them.
      </p>

      <section className="mt-8">
        <TrustedContactsManager />
      </section>

      <div className="mt-8">
        <Link href="/threats" className="text-slate2-700 underline">Skip and continue →</Link>
      </div>
    </main>
  );
}
