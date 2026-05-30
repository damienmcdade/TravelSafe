"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// Thin client island that owns the only client-dependent bit of the (app)
// shell: re-keying <main> on each route change so the `animate-fade-in`
// transition re-runs per page. Extracting this lets (app)/layout.tsx be a
// Server Component (the header/footer/nav chrome renders on the server and
// ships no JS), while this 12-line wrapper is the lone hydrated boundary.
// Previously the whole layout was "use client" purely to read
// `window.location.pathname` for this key.
export function AnimatedMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main
      id="main"
      key={pathname}
      className="max-w-5xl mx-auto px-4 py-6 animate-fade-in space-y-3"
    >
      {children}
    </main>
  );
}
