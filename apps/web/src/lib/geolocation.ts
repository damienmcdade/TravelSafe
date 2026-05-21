"use client";

const ERROR_MESSAGES: Record<number, string> = {
  1: "Location permission was blocked. Allow location access for this site in your browser settings, then try again.",
  2: "Your device could not determine its location. Try again, or move to an area with a clearer signal.",
  3: "Location lookup timed out. Try again in a moment.",
};

export class GeolocationError extends Error {
  constructor(public code: number, message?: string) {
    super(message ?? ERROR_MESSAGES[code] ?? `Location error (code ${code}).`);
    this.name = "GeolocationError";
  }
}

export async function requestLocation(): Promise<GeolocationPosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new GeolocationError(0, "Your browser does not support geolocation.");
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new GeolocationError(0, "Location requires a secure (https) connection.");
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      (err) => reject(new GeolocationError(err.code, ERROR_MESSAGES[err.code])),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
