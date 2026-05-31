import type { Metadata } from "next";
import Link from "next/link";
import { PHOTOS } from "@/lib/city-photos";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Photo Credits",
  description:
    "Attribution for the city backdrop photography used in CommunitySafe. All images are sourced from Wikimedia Commons and used under their respective licenses.",
};

// v93p3 — derive the per-photo attribution list from PHOTOS at build
// time. Each entry links to its Wikimedia Commons file page where the
// canonical photographer name + license version are documented; this
// satisfies CC-BY-SA 4.0 §3(a)(2) (attribution via URI to a resource
// that includes the required information).
function fileNameFromUrl(url: string): string {
  // Format: https://upload.wikimedia.org/wikipedia/commons/thumb/<hash>/<filename>.jpg/1920px-<filename>.jpg
  const m = url.match(/\/commons\/thumb\/[^/]+\/([^/]+)\/[^/]+$/);
  if (m) return decodeURIComponent(m[1]);
  // Fallback for non-thumb URLs
  const last = url.split("/").pop() ?? url;
  return decodeURIComponent(last.replace(/^1920px-/, ""));
}
function commonsPage(url: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileNameFromUrl(url))}`;
}
function prettyCity(slug: string): string {
  return slug.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

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
          share-alike. The links below point to each photo&apos;s canonical
          Wikimedia Commons page where the photographer&apos;s name and the
          exact license version are documented — attribution per
          CC-BY-SA 4.0 §3(a)(2) is by URI to that resource.
        </p>
      </header>

      <section className="surface p-5 space-y-3 text-sm text-slate2-700 leading-relaxed">
        <h2 className="font-display text-lg text-slate2-900">License summary</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>CC-BY 2.0 / 3.0 / 4.0</strong> — free commercial use, attribution required.</li>
          <li><strong>CC-BY-SA 2.0 / 3.0 / 4.0</strong> — same as CC-BY plus share-alike. Derivative works must be released under a compatible license.</li>
          <li><strong>Public domain / CC0</strong> — no attribution required, but credit is customary and we provide it where the source is known.</li>
        </ul>
        <p className="text-xs text-slate2-500">
          The CommunitySafe site code itself is unrelated to the photo licenses —
          our use of an image does not transitively license our application code.
        </p>
      </section>

      <section className="surface p-5 space-y-4 text-sm text-slate2-700">
        <h2 className="font-display text-lg text-slate2-900">Per-photo attribution</h2>
        <p className="text-xs text-slate2-500">
          {Object.keys(PHOTOS).length} cities · {Object.values(PHOTOS).reduce((s, a) => s + a.length, 0)} total photos.
          Click any filename to open its Wikimedia Commons page (photographer,
          license, upload history).
        </p>
        <div className="space-y-5">
          {Object.entries(PHOTOS).map(([city, urls]) => (
            <div key={city}>
              <h3 className="font-display text-sm text-slate2-900">{prettyCity(city)}</h3>
              <ul className="mt-1 pl-4 list-disc space-y-1 text-xs">
                {urls.map((url) => {
                  const name = fileNameFromUrl(url);
                  return (
                    <li key={url} className="truncate">
                      <a
                        href={commonsPage(url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-bay-700 hover:underline font-mono"
                      >
                        {name}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-muted p-4 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">Replacing or adding photos:</strong>{" "}
        before adding a Wikimedia URL to <code>CityBackdrop.tsx</code>, confirm
        the file&apos;s license on its Commons page. CC-BY-* and CC0 are accepted;
        non-free or unclear-license files are not. This page renders the
        attribution list from the same constant — no extra update is needed.
      </section>

      <LegalFooter />
    </main>
  );
}
