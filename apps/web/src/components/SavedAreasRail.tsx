"use client";
import { useSavedAreas } from "@/lib/use-saved-areas";
import { useArea } from "@/lib/use-area";
import { useCity } from "@/lib/use-city";

/// Horizontal rail of saved neighborhoods. Renders nothing when the list
/// is empty — the user opts in by tapping the star/save button next to
/// the currently-selected area in any picker. Tapping a chip sets the
/// global area (and visually highlights it). The current area chip gets
/// a filled background; the rest get the muted variant.
export function SavedAreasRail() {
  const { city } = useCity();
  const { area, setArea } = useArea(city.slug);
  const { saved, remove } = useSavedAreas();

  // Only show areas that belong to the current city — saved is global so
  // a user with multiple cities saved would otherwise see other cities'
  // neighborhoods mixed in.
  const visible = saved.filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase());
  if (visible.length === 0) return null;

  return (
    <section className="surface-muted px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
      <span className="text-slate2-500 uppercase tracking-wider font-medium mr-1">Saved:</span>
      {visible.map((a) => {
        const active = area?.slug === a.slug;
        return (
          <span
            key={a.slug}
            className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-1 transition-colors ${
              active
                ? "bg-bay-500 text-white"
                : "bg-white hover:bg-bay-100 text-slate2-700 ring-1 ring-sand-200"
            }`}
          >
            <button
              onClick={() => setArea({ slug: a.slug, label: a.label, jurisdiction: a.jurisdiction })}
              className="font-medium"
            >
              {a.label}
            </button>
            <button
              onClick={() => remove(a.slug)}
              aria-label={`Remove ${a.label} from saved`}
              className={`px-1.5 rounded-full transition-colors ${active ? "hover:bg-bay-700" : "hover:bg-coral-100"}`}
              title="Remove from saved"
            >
              ×
            </button>
          </span>
        );
      })}
    </section>
  );
}

/// Star button — shows save state for the currently-selected area and
/// toggles on tap. Placed next to area-context displays (the "Showing
/// X" strip on /safety-score, /trends, /threats).
export function SaveAreaStar({ area }: { area: { slug: string; label: string; jurisdiction: string } | null }) {
  const { isSaved, toggle, saved, max } = useSavedAreas();
  if (!area) return null;
  const saved_ = isSaved(area.slug);
  const atCap = saved.length >= max && !saved_;
  return (
    <button
      onClick={() => toggle(area)}
      disabled={atCap}
      title={saved_ ? "Unsave this neighborhood" : atCap ? `Saved list is full (${max} max)` : "Save this neighborhood"}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors ${
        saved_
          ? "bg-amber2-100 text-amber2-700 hover:bg-amber2-200"
          : atCap
            ? "text-slate2-500 cursor-not-allowed"
            : "text-slate2-700 hover:bg-bay-100"
      }`}
    >
      <span aria-hidden>{saved_ ? "★" : "☆"}</span>
      <span>{saved_ ? "Saved" : "Save"}</span>
    </button>
  );
}
