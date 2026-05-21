import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

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
      <body>{children}</body>
    </html>
  );
}
