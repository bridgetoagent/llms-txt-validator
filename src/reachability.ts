import type { Issue, ParsedDocument, ReachabilityReport, ValidateOptions } from "./types.js";

/**
 * Parallel link-reachability checker.
 *
 * Strategy:
 *   - HEAD request first (cheaper, doesn't pull body). Fall back to GET if HEAD
 *     returns 405 or the server appears to mishandle HEAD.
 *   - AbortController for per-request timeout.
 *   - Bounded concurrency via a small worker pool — we don't want to hammer
 *     someone's site just because their llms.txt lists 200 links.
 *   - Treat 3xx as reachable IF it lands at a 2xx (let fetch follow redirects
 *     transparently). Long redirect chains (>5 hops) get flagged separately.
 *
 * What we deliberately don't check:
 *   - Response body content. Even validating MIME types here would be
 *     premature — the llms.txt spec doesn't constrain what type of resource
 *     each link points at.
 *   - SSL certificate details. fetch will refuse expired certs; that surfaces
 *     as a network error which we report as `link-unreachable`.
 */

interface CheckJob {
  url: string;
  line: number;
}

interface CheckResult {
  url: string;
  line: number;
  ok: boolean;
  status?: number;
  durationMs: number;
  /** Short human-readable reason for failure. */
  reason?: string;
}

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SLOW_THRESHOLD_MS = 3000;

export async function checkReachability(
  parsed: ParsedDocument,
  options: ValidateOptions = {},
): Promise<{ issues: Issue[]; report: ReachabilityReport }> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
  const fetchImpl: typeof fetch = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    return {
      issues: [
        {
          severity: "warning",
          code: "link-unreachable",
          message:
            "Reachability check requested but no fetch implementation available. Pass `fetchImpl` or run on Node 18+.",
        },
      ],
      report: { checked: 0, failed: 0, slow: 0 },
    };
  }

  // Collect all checkable URLs (skip relative, fragments, mailto, missing-scheme).
  const jobs: CheckJob[] = [];
  for (const section of parsed.sections) {
    for (const link of section.links) {
      if (!/^https?:\/\//i.test(link.url)) continue;
      jobs.push({ url: link.url, line: link.line });
    }
  }

  const results = await runWithConcurrency(jobs, concurrency, (job) =>
    checkOne(job, fetchImpl, timeoutMs),
  );

  const issues: Issue[] = [];
  let failed = 0;
  let slow = 0;
  for (const result of results) {
    if (!result.ok) {
      failed += 1;
      issues.push({
        severity: "error",
        code: result.status !== undefined ? "link-non-2xx" : "link-unreachable",
        message:
          result.status !== undefined
            ? `Link returned HTTP ${result.status}: ${result.url}`
            : `Link unreachable: ${result.url} (${result.reason ?? "network error"})`,
        line: result.line,
      });
      continue;
    }
    if (result.durationMs > slowThresholdMs) {
      slow += 1;
      issues.push({
        severity: "warning",
        code: "link-slow",
        message: `Link is slow (${Math.round(result.durationMs)}ms): ${result.url}. Agents may time out.`,
        line: result.line,
      });
    }
  }

  return {
    issues,
    report: {
      checked: results.length,
      failed,
      slow,
    },
  };
}

async function checkOne(
  job: CheckJob,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<CheckResult> {
  const start = performance.now();

  // First attempt — HEAD.
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, job.url, "HEAD", timeoutMs);
  } catch (err) {
    return {
      url: job.url,
      line: job.line,
      ok: false,
      durationMs: performance.now() - start,
      reason: errMessage(err),
    };
  }

  // Some servers reject HEAD with 405; fall back to GET in that case.
  if (response.status === 405 || response.status === 501) {
    try {
      response = await fetchWithTimeout(fetchImpl, job.url, "GET", timeoutMs);
    } catch (err) {
      return {
        url: job.url,
        line: job.line,
        ok: false,
        durationMs: performance.now() - start,
        reason: errMessage(err),
      };
    }
  }

  return {
    url: job.url,
    line: job.line,
    ok: response.ok,
    status: response.status,
    durationMs: performance.now() - start,
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "bridgetoagent-llms-txt-validator/0.1 (+https://github.com/bridgetoagent/llms-txt-validator)",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Simple bounded-concurrency worker pool. Resolves in input order, regardless
 * of completion order, so issues remain associated with their original line
 * numbers in order.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const slots = Math.max(1, Math.min(concurrency, items.length));

  for (let w = 0; w < slots; w++) {
    workers.push(
      (async () => {
        while (true) {
          const myIndex = cursor;
          if (myIndex >= items.length) return;
          cursor += 1;
          const item = items[myIndex];
          if (item === undefined) return;
          results[myIndex] = await worker(item);
        }
      })(),
    );
  }

  await Promise.all(workers);
  return results;
}
