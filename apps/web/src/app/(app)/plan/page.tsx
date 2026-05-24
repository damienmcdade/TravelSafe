"use client";
import SafeRoutePage from "../route/page";

/// `/plan` — legacy hub URL. After the v5 IA split (Safety Score moved
/// into City Awareness, Safe Route promoted to a top-level tab), this
/// route only exists to keep old bookmarks alive. We render the Safe
/// Route page directly so anyone hitting /plan or /plan?tab=route
/// lands somewhere useful instead of a 404. Nav strip points to /route
/// now; this page is bookmark-preservation only.
export default function PlanPage() {
  return <SafeRoutePage />;
}
