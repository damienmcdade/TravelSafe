import "server-only";
import { z } from "zod";

// fix(audit loc-coords-2): coordinates were accepted as bare z.number() and
// persisted / embedded into Google Maps links without range validation, so a
// junk or out-of-range pair (e.g. lat 9999) could be stored and surfaced. These
// schemas bound latitude to [-90, 90] and longitude to [-180, 180]. Reuse across
// every route that ingests a coordinate.
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

/// Validate a free-form lat/lng pair (e.g. from query-string numbers). Returns
/// the parsed pair or null if either is missing/out of range.
export function parseCoordPair(latRaw: string | null, lngRaw: string | null): { lat: number; lng: number } | null {
  if (latRaw == null || lngRaw == null) return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const ok = latitude.safeParse(lat).success && longitude.safeParse(lng).success;
  return ok ? { lat, lng } : null;
}
