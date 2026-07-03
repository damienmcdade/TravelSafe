import "server-only";

/// The widget/watch clients build the city slug from a user-typed label
/// ("New York City" → "new-york-city"), which doesn't always match the
/// registry slug. Normalize punctuation and map the known label-derived
/// aliases onto canonical slugs so free-text city entry resolves without
/// requiring a client update. Unknown cities still 404 downstream.
const ALIASES: Record<string, string> = {
  "new-york-city": "new-york",
  "nyc": "new-york",
  "washington": "washington-dc",
  "washington-d-c": "washington-dc",
};

export function canonicalCitySlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/['’.,]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return ALIASES[s] ?? s;
}
