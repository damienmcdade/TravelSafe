import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl text-slate2-900">TravelSafe</h1>
      <p className="mt-2 text-slate2-500">San Diego, CA</p>

      <section className="mt-10 surface p-6">
        <h2 className="font-display text-2xl text-slate2-900">What this app does</h2>
        <ul className="mt-3 space-y-2 text-slate2-700">
          <li>• Shows <strong>area-level</strong> safety context for San Diego neighborhoods, drawn from public crime data.</li>
          <li>• Lets you arm a <strong>personal check-in timer</strong> and share a temporary location link with your trusted contacts.</li>
          <li>• Hosts a moderated community feed where neighbors describe behavior and places — never individual people or addresses.</li>
        </ul>
        <h2 className="font-display text-2xl mt-8 text-slate2-900">What this app does not do</h2>
        <ul className="mt-3 space-y-2 text-slate2-700">
          <li>• It does not surveil, track, or geolocate individuals.</li>
          <li>• It does not contact emergency services on your behalf. In an emergency, call 911 directly.</li>
          <li>• It does not collect demographic data (no age, gender, ethnicity, religion).</li>
          <li>• Community posts are reviewed; they are not a substitute for police reports.</li>
        </ul>
      </section>

      <div className="mt-10 flex flex-wrap gap-3 items-center">
        <Link href="/threats" className="px-4 py-2 bg-slate2-900 text-sand-50 rounded-xl">
          Explore TravelSafe
        </Link>
        <span className="text-sm text-slate2-500">
          No sign-up needed for browsing.{" "}
          <Link href="/login" className="underline">Sign in</Link> or{" "}
          <Link href="/register" className="underline">create an account</Link>{" "}
          if you want to post, set up trusted contacts, or use the check-in timer.
        </span>
      </div>
    </main>
  );
}
