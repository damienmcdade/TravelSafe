import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CityBackdrop } from "@/components/CityBackdrop";
import { SessionBootstrap } from "@/components/SessionBootstrap";

// Title template — each page sets its own `title` (e.g. "Safety Score")
// and Next slots it into "{title} · TravelSafe" automatically. Default is
// the fallback for pages that don't set one explicitly.
export const metadata: Metadata = {
  title: {
    default: "TravelSafe",
    template: "%s · TravelSafe",
  },
  description:
    "Neighborhood-level safety awareness across 29 US cities. Drawn from " +
    "official police data sources and the FBI Crime in the Nation 2024 " +
    "national average. Not surveillance; not a substitute for emergency services.",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* CityBackdrop sits at z:0 (its own stacking context via position:fixed).
            All page content is wrapped in `relative z-10` so it paints above the
            backdrop instead of underneath. The body is transparent so the
            backdrop is the actual paint at the bottom of the viewport. */}
        <CityBackdrop />
        <SessionBootstrap />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
