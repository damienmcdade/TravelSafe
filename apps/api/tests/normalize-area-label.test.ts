import { describe, it, expect } from "vitest";
import { normalizeAreaLabel } from "@travelsafe/crime-data/cities";

// Regression guard for the Baltimore (and stray Baton Rouge / Long Beach /
// Tampa) ALL-CAPS neighborhood labels that rendered "ABELL", "BELAIR-EDISON"
// verbatim in the wheel, the Neighborhood Watch header, and every card.
// normalizeAreaLabel is the single choke point that title-cases them while
// leaving already-correct labels untouched (idempotent).
describe("normalizeAreaLabel", () => {
  it("title-cases all-caps single words", () => {
    expect(normalizeAreaLabel("ABELL")).toBe("Abell");
    expect(normalizeAreaLabel("ARCADIA")).toBe("Arcadia");
  });

  it("preserves hyphens and slashes as separators", () => {
    expect(normalizeAreaLabel("BELAIR-EDISON")).toBe("Belair-Edison");
    expect(normalizeAreaLabel("AUCHENTOROLY-PARKWOOD")).toBe("Auchentoroly-Parkwood");
  });

  it("title-cases multi-word labels", () => {
    expect(normalizeAreaLabel("ARMISTEAD GARDENS")).toBe("Armistead Gardens");
    expect(normalizeAreaLabel("BALTIMORE HIGHLANDS")).toBe("Baltimore Highlands");
  });

  it("capitalizes after apostrophes", () => {
    expect(normalizeAreaLabel("O'DONNELL HEIGHTS")).toBe("O'Donnell Heights");
  });

  it("keeps compass/initialism acronyms upper-case", () => {
    expect(normalizeAreaLabel("NE COMMUNITY")).toBe("NE Community");
  });

  it("lower-cases interior connector words", () => {
    expect(normalizeAreaLabel("CITY OF THE LAKES")).toBe("City of the Lakes");
  });

  it("leaves already-cased labels untouched (idempotent)", () => {
    for (const good of ["Linda Vista", "East Boston", "North (Sector A)", "McNeil", "Belair-Edison", "Ward 1"]) {
      expect(normalizeAreaLabel(good)).toBe(good);
      expect(normalizeAreaLabel(normalizeAreaLabel(good))).toBe(good);
    }
  });

  it("is idempotent on all-caps input", () => {
    expect(normalizeAreaLabel(normalizeAreaLabel("BELAIR-EDISON"))).toBe("Belair-Edison");
  });

  it("collapses runaway whitespace", () => {
    expect(normalizeAreaLabel("  Mount   Washington  ")).toBe("Mount Washington");
  });

  it("handles empty/edge input safely", () => {
    expect(normalizeAreaLabel("")).toBe("");
  });

  it("repairs backtick-as-apostrophe regardless of casing", () => {
    expect(normalizeAreaLabel("Brigand`s Quay")).toBe("Brigand's Quay");
  });

  it("preserves known campus/initialism acronyms", () => {
    expect(normalizeAreaLabel("CSULB")).toBe("CSULB");
  });

  it("preserves Hawaiian okina/macron spelling (already-cased)", () => {
    for (const name of ["‘Āhuimanu", "He‘eia", "Kahalu‘u"]) {
      expect(normalizeAreaLabel(name)).toBe(name);
    }
  });

  it("leaves numerals/hash labels intact", () => {
    expect(normalizeAreaLabel("Grandmont #1")).toBe("Grandmont #1");
  });
});
