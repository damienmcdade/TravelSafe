import { describe, it, expect } from "vitest";
import { cityLocalToUtcIso, CITY_TIMEZONES } from "@travelsafe/crime-data/lib/city-time";
import { CITIES } from "@travelsafe/crime-data/cities";

// v96p2 — pure-logic tests for the city-local → UTC helper. No
// network, no DB. The classifier maps every supported city to an
// IANA timezone; the converter applies DST-aware offsets.

describe("cityLocalToUtcIso", () => {
  it("converts LA wall-clock to UTC (PDT, summer)", () => {
    // 2026-07-16 22:40 in Los Angeles (PDT, UTC-7) → 05:40Z next day
    expect(cityLocalToUtcIso("2026-07-16T22:40:00", "America/Los_Angeles"))
      .toBe("2026-07-17T05:40:00.000Z");
  });

  it("converts LA wall-clock to UTC (PST, winter)", () => {
    // 2026-01-16 22:40 in Los Angeles (PST, UTC-8) → 06:40Z next day
    expect(cityLocalToUtcIso("2026-01-16T22:40:00", "America/Los_Angeles"))
      .toBe("2026-01-17T06:40:00.000Z");
  });

  it("converts NY wall-clock to UTC (EDT)", () => {
    // 2026-07-16 10:30 ET (UTC-4 summer) → 14:30Z same day
    expect(cityLocalToUtcIso("2026-07-16T10:30:00", "America/New_York"))
      .toBe("2026-07-16T14:30:00.000Z");
  });

  it("converts Chicago wall-clock to UTC (CST)", () => {
    // 2026-01-15 09:00 CT (UTC-6 winter) → 15:00Z same day
    expect(cityLocalToUtcIso("2026-01-15T09:00:00", "America/Chicago"))
      .toBe("2026-01-15T15:00:00.000Z");
  });

  it("converts Honolulu wall-clock to UTC (no DST)", () => {
    // Honolulu = UTC-10 year-round
    expect(cityLocalToUtcIso("2026-06-01T08:00:00", "Pacific/Honolulu"))
      .toBe("2026-06-01T18:00:00.000Z");
  });

  it("converts Phoenix wall-clock to UTC (no DST)", () => {
    // Phoenix = MST UTC-7 year-round
    expect(cityLocalToUtcIso("2026-07-01T15:00:00", "America/Phoenix"))
      .toBe("2026-07-01T22:00:00.000Z");
  });

  it("accepts space-separated form (Socrata floating_timestamp)", () => {
    expect(cityLocalToUtcIso("2026-07-16 22:40:00", "America/Los_Angeles"))
      .toBe("2026-07-17T05:40:00.000Z");
  });

  it("passes through an input that already carries Z", () => {
    expect(cityLocalToUtcIso("2026-05-29T03:00:00.000Z", "America/New_York"))
      .toBe("2026-05-29T03:00:00.000Z");
  });

  it("passes through an input with a numeric offset", () => {
    // 03:00 +05:00 = 22:00 prior day UTC
    expect(cityLocalToUtcIso("2026-05-29T03:00:00+05:00", "America/New_York"))
      .toBe("2026-05-28T22:00:00.000Z");
  });

  it("returns epoch 0 for empty / null input", () => {
    expect(cityLocalToUtcIso("", "America/New_York")).toBe("1970-01-01T00:00:00.000Z");
    expect(cityLocalToUtcIso(undefined, "America/New_York")).toBe("1970-01-01T00:00:00.000Z");
    expect(cityLocalToUtcIso(null, "America/New_York")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns epoch 0 for unparseable garbage", () => {
    expect(cityLocalToUtcIso("not-a-date", "America/New_York")).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("CITY_TIMEZONES", () => {
  // v99 — derive the expected set from the canonical CITIES registry
  // instead of a hand-maintained literal. The old hardcoded list went
  // stale (it still listed phoenix & nashville after their feeds froze
  // and they were swapped out, and it never gained long-beach), so it
  // asserted the wrong thing. Sourcing from CITIES means every city the
  // app actually supports MUST have a timezone, and the test can't drift
  // from the registry again.
  it("covers every supported city in the CITIES registry", () => {
    for (const city of CITIES) {
      expect(CITY_TIMEZONES[city.slug], `missing tz for ${city.slug}`).toBeTruthy();
    }
  });
});
