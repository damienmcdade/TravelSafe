import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CityBackdrop } from "@/components/CityBackdrop";

export const metadata: Metadata = {
  title: "TravelSafe",
  description:
    "Neighborhood-level safety awareness for San Diego, Los Angeles, and San Francisco. " +
    "Drawn from official police data sources. Not surveillance; not a substitute for emergency services.",
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
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
