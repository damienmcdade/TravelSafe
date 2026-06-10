// Group-level loading skeleton for every route under (app). React's
// streaming SSR uses this as a placeholder while the route segment's
// server components fetch — before this file existed, navigating
// between tabs showed a blank screen during the RSC round-trip.
//
// Deliberately minimal: two stacked rounded blocks that match the page
// hero + first surface card on most routes. The page's own loading
// state (per-card skeletons in CrimeMap, RouteMap, TrendPanel, etc.)
// takes over as soon as the route component mounts.
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="page-hero">
        <div className="skel h-4 w-32" />
        <div className="skel h-9 w-3/4 mt-3" />
        <div className="skel h-4 w-full mt-3 max-w-2xl" />
      </div>
      <div className="surface p-5">
        <div className="skel h-5 w-40" />
        <div className="skel h-3 w-full mt-3" />
        <div className="skel h-3 w-5/6 mt-2" />
        <div className="skel h-32 w-full mt-4" />
      </div>
    </div>
  );
}
