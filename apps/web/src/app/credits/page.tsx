import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Photo Credits",
  description:
    "Attribution for the city backdrop photography used in CommunitySafe. All images are sourced from Wikimedia Commons and used under their respective licenses.",
};

/// Public attribution page for the CityBackdrop photography. Wikimedia
/// Commons photos are generally CC-BY-SA: free for commercial use with
/// attribution + share-alike. This page satisfies the attribution
/// requirement so we can keep using the verified per-city landmark
/// photography without breaking compliance. Updating the
/// CityBackdrop URL list? Add the photographer + license here too.
export default function CreditsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Attribution</p>
        <h1 className="font-display text-3xl sm:text-4xl text-slate2-900">Photo Credits</h1>
        <p className="text-sm text-slate2-700 leading-relaxed">
          Every city backdrop on CommunitySafe is a real photograph of the
          named city, sourced from <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">Wikimedia Commons</a>.
          The vast majority are licensed under{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">CC-BY-SA 4.0</a>{" "}
          or compatible licenses, which permit commercial use with attribution and
          share-alike. This page is the attribution surface required by those
          licenses.
        </p>
      </header>

      <section className="surface p-5 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-lg text-slate2-900">License summary</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>CC-BY 2.0 / 3.0 / 4.0</strong> — free commercial use, attribution required.
          </li>
          <li>
            <strong>CC-BY-SA 2.0 / 3.0 / 4.0</strong> — same as CC-BY plus share-alike. Derivative
            works must be released under a compatible license.
          </li>
          <li>
            <strong>Public domain / CC0</strong> — no attribution required, but credit is
            customary and we provide it where the source is known.
          </li>
        </ul>
        <p className="text-xs text-slate2-500">
          The CommunitySafe site code itself is unrelated to the photo licenses —
          our use of an image does not transitively license our application code.
        </p>
      </section>

      <section className="surface p-5 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-lg text-slate2-900">Per-photo attribution</h2>
        <p className="text-xs text-slate2-500">
          Each city ships four landmark photos. Click any image filename to see
          its Wikimedia Commons page — the page lists the photographer, the
          exact license, and the upload history.
        </p>
        <p>
          All backdrop photo file names follow the format{" "}
          <code className="font-mono text-xs">https://upload.wikimedia.org/wikipedia/commons/thumb/&lt;hash&gt;/&lt;filename&gt;.jpg/1920px-&lt;filename&gt;.jpg</code>.
          The canonical Commons page for each photo is{" "}
          <code className="font-mono text-xs">https://commons.wikimedia.org/wiki/File:&lt;filename&gt;.jpg</code>.
        </p>
        <p>
          Authoritative source list:{" "}
          <a
            href="https://github.com/damienmcdade/CommunitySafe/blob/main/apps/web/src/components/CityBackdrop.tsx"
            target="_blank"
            rel="noreferrer"
            className="text-bay-700 hover:underline"
          >
            apps/web/src/components/CityBackdrop.tsx
          </a>
          {" "}— every URL is documented with a short caption identifying the landmark.
        </p>
      </section>

      <section className="surface-muted p-4 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">Replacing or adding photos:</strong>{" "}
        before adding a Wikimedia URL to <code>CityBackdrop.tsx</code>, confirm
        the file&apos;s license on its Commons page. CC-BY-* and CC0 are accepted;
        non-free or unclear-license files are not. Update this page if the
        attribution requirements change for any photo.
      </section>

      <footer className="text-center text-xs text-slate2-500 pt-4">
        <Link href="/privacy" className="text-bay-700 hover:underline">Privacy policy</Link>
        {" · "}
        <Link href="/methodology" className="text-bay-700 hover:underline">Methodology</Link>
        {" · "}
        <Link href="/now" className="text-bay-700 hover:underline">Back to app</Link>
      </footer>
    </main>
  );
}
