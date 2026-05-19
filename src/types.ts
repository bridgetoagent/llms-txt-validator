/**
 * Public types for @bridgetoagent-com/llms-txt-validator.
 *
 * Reference: https://llmstxt.org
 */

export type Severity = "error" | "warning" | "info";

/**
 * Issue codes — stable identifiers for each kind of finding.
 * Tests + downstream tooling pin on these codes.
 */
export type IssueCode =
  // Parser / structure
  | "missing-title"
  | "title-not-first"
  | "title-not-h1"
  | "duplicate-title"
  | "section-wrong-level"
  | "empty-section"
  // Link syntax
  | "malformed-link"
  | "link-missing-url"
  | "link-empty-text"
  | "link-relative-url"
  | "link-hash-only"
  | "link-mailto"
  | "link-non-https"
  | "duplicate-url"
  | "duplicate-link-text"
  // Reachability
  | "link-unreachable"
  | "link-slow"
  | "link-non-2xx"
  | "link-redirect-chain"
  // Content quality
  | "no-content-after-title"
  | "trailing-whitespace"
  | "tabs-instead-of-spaces";

export interface Issue {
  severity: Severity;
  code: IssueCode;
  message: string;
  line?: number;
  column?: number;
  /** The raw source line, when available, for easier debugging. */
  raw?: string;
}

export interface ParsedLink {
  /** Display text from the markdown link. */
  text: string;
  /** URL as written in the source (may be relative, may be invalid). */
  url: string;
  /** Optional description after the colon, per llms.txt convention. */
  description?: string;
  /** 1-indexed source line where the link appears. */
  line: number;
}

export interface ParsedSection {
  /** Section title as it appears after the `## ` prefix. */
  title: string;
  /** 1-indexed line of the `## Title` line. */
  line: number;
  /** Links in this section. */
  links: ParsedLink[];
}

export interface ParsedDocument {
  /** Title from the first `# Title` line. Empty string if missing. */
  title: string;
  /** 1-indexed line of the title, or null if missing. */
  titleLine: number | null;
  /** Optional blockquote/description immediately after the title. */
  description?: string;
  /** Free-form content lines between title and first section. */
  introContent: string;
  /** All H2 sections, in document order. */
  sections: ParsedSection[];
  /** Issues found during parsing (structure, malformed links). */
  parseIssues: Issue[];
}

export type ValidationStatus = "pass" | "pass_with_warnings" | "fail";

export interface ReachabilityReport {
  /** URLs that were actually checked. */
  checked: number;
  /** URLs that failed (non-2xx, timeout, network error). */
  failed: number;
  /** URLs that took longer than the slow-link threshold but still returned 2xx. */
  slow: number;
}

export interface ValidationReport {
  status: ValidationStatus;
  /** Aggregate counts for the summary banner. */
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    sections: number;
    links: number;
  };
  /** All issues (parse + validation + reachability), in order. */
  issues: Issue[];
  /** Parsed structure — useful for tooling that wants to render the document tree. */
  parsed: ParsedDocument;
  /** Reachability stats, when reachability checking was enabled. */
  reachability?: ReachabilityReport;
}

export interface ValidateOptions {
  /**
   * If true, performs HEAD requests against each link to verify reachability.
   * Defaults to false because it requires network I/O.
   */
  checkReachability?: boolean;
  /** Maximum concurrent HEAD requests. Default 8. */
  concurrency?: number;
  /** Timeout per HEAD request, in ms. Default 5000. */
  timeoutMs?: number;
  /** Links that respond slower than this threshold get flagged as `link-slow`. Default 3000. */
  slowThresholdMs?: number;
  /**
   * Optional override for the fetch implementation — useful for tests + Node 18+ where
   * native fetch is available. Defaults to globalThis.fetch.
   */
  fetchImpl?: typeof fetch;
}
