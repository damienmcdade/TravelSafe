import { describe, it, expect, vi, afterEach } from "vitest";
import { socrataDate, fetchSocrata, fetchWithRetry } from "@travelsafe/crime-data/lib/http";

// v96p2 — Socrata helpers: pure-logic unit tests for date stripping
// and the transient-retry classifier. Both surfaces were untested
// per the audit.

describe("socrataDate", () => {
  it("strips the .NNNZ suffix", () => {
    const ms = Date.UTC(2025, 10, 30, 0, 57, 24, 760);
    expect(socrataDate(ms)).toBe("2025-11-30T00:57:24");
  });
  it("accepts a Date instance", () => {
    const d = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(socrataDate(d)).toBe("2026-01-01T12:00:00");
  });
  it("never emits a trailing Z (Socrata rejects it)", () => {
    expect(socrataDate(Date.now())).not.toMatch(/Z$/);
  });
});

// Mock fetch for retry tests so we don't hit the network. vitest's
// global.fetch can be reassigned per-test.
const ORIGINAL_FETCH = global.fetch;
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("fetchSocrata retry classifier", () => {
  it("returns rows on first success", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "1" }]), { status: 200 }),
    );
    const rows = await fetchSocrata<{ id: string }>("Test", { url: "https://x/y.json" });
    expect(rows).toEqual([{ id: "1" }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 4xx error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Bad request", { status: 400 }),
    );
    await expect(fetchSocrata("Test", { url: "https://x/y.json" })).rejects.toThrow(/Test 400/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 5xx error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Server error", { status: 503 }),
    );
    await expect(fetchSocrata("Test", { url: "https://x/y.json" })).rejects.toThrow(/Test 503/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries an undici-style transient and recovers", async () => {
    const transient = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    });
    global.fetch = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "ok" }]), { status: 200 }));
    const rows = await fetchSocrata<{ id: string }>("Test", { url: "https://x/y.json" });
    expect(rows).toEqual([{ id: "ok" }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a caller AbortError (genuine cancellation)", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    global.fetch = vi.fn().mockRejectedValue(abort);
    await expect(fetchSocrata("Test", { url: "https://x/y.json" })).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // v110 — AbortSignal.timeout() fires a DOMException named "TimeoutError"
  // ("The operation was aborted due to timeout"). The upstream was just slow;
  // the next attempt usually lands inside budget, so it MUST be retried.
  it("retries a TimeoutError (AbortSignal.timeout) and recovers", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    global.fetch = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "warm" }]), { status: 200 }));
    const rows = await fetchSocrata<{ id: string }>("Test", { url: "https://x/y.json" });
    expect(rows).toEqual([{ id: "warm" }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries on persistent transient", async () => {
    const transient = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    });
    global.fetch = vi.fn().mockRejectedValue(transient);
    await expect(fetchSocrata("Test", { url: "https://x/y.json" })).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(3);  // 1 + 2 retries
  });
});

describe("fetchWithRetry", () => {
  it("retries a generic transient once and recovers", async () => {
    const transient = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "EAI_AGAIN" },
    });
    global.fetch = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(new Response("ok"));
    const res = await fetchWithRetry("https://x/y");
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
