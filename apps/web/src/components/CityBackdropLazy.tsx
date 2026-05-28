"use client";
// v96 — client-only wrapper around CityBackdrop so the root layout
// (a Server Component) can still pull it in via a plain import while
// next/dynamic + ssr:false defers the heavy 169 kB chunk to client
// mount only. Next 15 forbids `dynamic(..., { ssr: false })` inside
// a Server Component, so the indirection lives here.
import dynamic from "next/dynamic";

export const CityBackdropLazy = dynamic(
  () => import("./CityBackdrop").then((m) => m.CityBackdrop),
  { ssr: false },
);
