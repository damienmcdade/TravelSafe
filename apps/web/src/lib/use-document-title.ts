"use client";
import { useEffect } from "react";

/// Client-side document.title hook. The (app) routes are all client
/// components (they read live data via useApi + useArea + useCity), so we
/// can't use Next's static `metadata` export — `metadata` only works in
/// Server Components. Setting document.title in a useEffect achieves the
/// same browser-tab labeling without needing a server-component wrapper
/// per route. The format mirrors the root layout's `template: "%s ·
/// TravelSafe"` for consistency: pass just the page-specific bit and the
/// hook appends the brand suffix.
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const original = document.title;
    if (title) document.title = `${title} · TravelSafe`;
    return () => { document.title = original; };
  }, [title]);
}
