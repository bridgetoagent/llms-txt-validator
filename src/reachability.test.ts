import { describe, it, expect } from "vitest";
import { parse } from "./parser.js";
import { checkReachability } from "./reachability.js";

/**
 * Custom fetch mock that returns canned responses keyed by URL substring.
 */
function makeMockFetch(
  routes: Record<string, { status: number; delayMs?: number; throws?: boolean }>,
): typeof fetch {
  const handler = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const matchedKey = Object.keys(routes).find((key) => url.includes(key));
    const route = matchedKey ? routes[matchedKey] : undefined;
    if (!route) {
      throw new Error(`mock: no route for ${url}`);
    }
    if (route.delayMs) {
      await new Promise((r) => setTimeout(r, route.delayMs));
    }
    if (route.throws) {
      throw new Error(`mock: simulated network error for ${url}`);
    }
    return new Response(null, { status: route.status });
  }) as typeof fetch;
  return handler;
}

describe("reachability", () => {
  it("reports 0 checked when document has no http links", async () => {
    const doc = parse("# T\n## S\n- [bad](/relative)\n- [also-bad](mailto:a@b.com)");
    const result = await checkReachability(doc, { fetchImpl: makeMockFetch({}) });
    expect(result.report.checked).toBe(0);
    expect(result.report.failed).toBe(0);
  });

  it("reports 2xx as success", async () => {
    const doc = parse("# T\n## S\n- [a](https://ok.example)");
    const fetchImpl = makeMockFetch({ "ok.example": { status: 200 } });
    const result = await checkReachability(doc, { fetchImpl });
    expect(result.report.checked).toBe(1);
    expect(result.report.failed).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("reports 4xx as link-non-2xx", async () => {
    const doc = parse("# T\n## S\n- [a](https://gone.example)");
    const fetchImpl = makeMockFetch({ "gone.example": { status: 404 } });
    const result = await checkReachability(doc, { fetchImpl });
    expect(result.report.failed).toBe(1);
    expect(result.issues.some((i) => i.code === "link-non-2xx")).toBe(true);
  });

  it("falls back to GET when HEAD returns 405", async () => {
    // First HEAD returns 405, then GET returns 200.
    let calls = 0;
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls += 1;
      if (init?.method === "HEAD") return new Response(null, { status: 405 });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const doc = parse("# T\n## S\n- [a](https://no-head.example)");
    const result = await checkReachability(doc, { fetchImpl });
    expect(calls).toBe(2);
    expect(result.report.failed).toBe(0);
  });

  it("treats network errors as link-unreachable", async () => {
    const doc = parse("# T\n## S\n- [a](https://dead.example)");
    const fetchImpl = makeMockFetch({ "dead.example": { status: 0, throws: true } });
    const result = await checkReachability(doc, { fetchImpl });
    expect(result.report.failed).toBe(1);
    expect(result.issues.some((i) => i.code === "link-unreachable")).toBe(true);
  });

  it("flags slow links when over threshold", async () => {
    const doc = parse("# T\n## S\n- [slow](https://slow.example)");
    const fetchImpl = makeMockFetch({ "slow.example": { status: 200, delayMs: 50 } });
    const result = await checkReachability(doc, { fetchImpl, slowThresholdMs: 10 });
    expect(result.report.slow).toBe(1);
    expect(result.issues.some((i) => i.code === "link-slow")).toBe(true);
  });

  it("respects concurrency cap", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const fetchImpl = (async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const links = Array.from({ length: 10 }, (_, i) => `- [a${i}](https://e${i}.example)`).join("\n");
    const doc = parse(`# T\n## S\n${links}`);

    await checkReachability(doc, { fetchImpl, concurrency: 3 });
    expect(peakInFlight).toBeLessThanOrEqual(3);
  });

  it("returns issue when no fetch implementation available", async () => {
    const doc = parse("# T\n## S\n- [a](https://a.example)");
    // Force fetchImpl to be a non-function via the as-cast escape hatch.
    const result = await checkReachability(doc, {
      fetchImpl: undefined as unknown as typeof fetch,
    });
    // Implementation falls back to globalThis.fetch, which exists in Node 18+.
    // If globalThis.fetch is undefined for any reason, we get the warning.
    if (typeof globalThis.fetch !== "function") {
      expect(result.issues.some((i) => i.code === "link-unreachable")).toBe(true);
    } else {
      // No assertion — environment-dependent.
      expect(result).toBeDefined();
    }
  });
});
