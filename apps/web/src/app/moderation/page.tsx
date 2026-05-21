"use client";
import { api, useApi } from "@/lib/api-client";

interface ReportedPost {
  id: string;
  body: string;
  kind: string;
  status: string;
  createdAt: string;
  reportCount: number;
  area: { name: string };
  author: { email: string; displayName: string | null };
  flags: { kind: string; detail: string | null }[];
}

// Manual verification of community posts has been removed — posts publish
// automatically as long as they pass the profanity / threat pre-vetter.
// This page is now a read-only activity log of recently reported posts so
// moderators with MODERATOR_EMAILS access can spot abuse patterns.
export default function ModerationActivityPage() {
  const { data, reload } = useApi<ReportedPost[]>("/moderation/queue");

  async function takeDown(id: string) {
    if (!confirm("Take this post down? It will no longer appear in any feed.")) return;
    await api(`/moderation/posts/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ action: "REJECT", reason: "Moderator take-down from activity log", confirmedAreaLevelAndAnonymized: false }),
    });
    await reload();
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl text-slate2-900">Moderation activity</h1>
        <p className="mt-2 text-sm text-slate2-700">
          CommunitySafe posts publish automatically after the profanity and threat checks pass. This page lists recently reported posts so a moderator can take them down if needed. Set <code>MODERATOR_EMAILS</code> in the API environment to grant access.
        </p>
      </header>
      {(data ?? []).length === 0 && <p className="text-slate2-500 text-sm">No reported or pending posts.</p>}
      {(data ?? []).map((p) => (
        <article key={p.id} className="surface p-5">
          <header className="flex justify-between items-center text-xs text-slate2-500">
            <span>{p.area.name} · {p.kind} · {new Date(p.createdAt).toLocaleString()}</span>
            <span>{p.reportCount > 0 ? `${p.reportCount} report${p.reportCount === 1 ? "" : "s"}` : "Auto-published"}</span>
          </header>
          <pre className="mt-3 whitespace-pre-wrap text-slate2-900 font-sans">{p.body}</pre>
          {p.flags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {p.flags.map((f, i) => (
                <li key={i} className="px-2 py-1 surface-muted">{f.kind}{f.detail ? `: ${f.detail}` : ""}</li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <button onClick={() => takeDown(p.id)} className="px-3 py-1.5 bg-dusk-700 text-white rounded-xl text-sm">Take down</button>
          </div>
        </article>
      ))}
    </main>
  );
}
