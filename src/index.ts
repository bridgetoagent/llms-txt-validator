/**
 * @bridgetoagent-com/llms-txt-validator
 *
 * Public API entry point. Two main functions:
 *
 *   - `validate(source, options?)` — runs the full pipeline (parse + structure
 *     validation + optional link reachability) and returns a structured report.
 *   - `parse(source)` — returns just the parsed document tree if you want to
 *     run your own checks.
 *
 * Reference spec: https://llmstxt.org
 */

export { parse } from "./parser.js";
export { checkReachability } from "./reachability.js";

export type {
  Issue,
  IssueCode,
  ParsedDocument,
  ParsedLink,
  ParsedSection,
  ReachabilityReport,
  Severity,
  ValidateOptions,
  ValidationReport,
  ValidationStatus,
} from "./types.js";

import { parse } from "./parser.js";
import { checkReachability } from "./reachability.js";
import type { Issue, ValidateOptions, ValidationReport, ValidationStatus } from "./types.js";

/**
 * Validate llms.txt source text.
 *
 * @param source — raw text content of an llms.txt file.
 * @param options — see ValidateOptions. By default, reachability checking is OFF
 *   (no network I/O). Pass `{ checkReachability: true }` to enable it.
 */
export async function validate(
  source: string,
  options: ValidateOptions = {},
): Promise<ValidationReport> {
  const parsed = parse(source);

  const allIssues: Issue[] = [...parsed.parseIssues];
  let reachabilityReport;

  if (options.checkReachability) {
    const r = await checkReachability(parsed, options);
    allIssues.push(...r.issues);
    reachabilityReport = r.report;
  }

  const summary = summarize(allIssues, parsed);
  const status = deriveStatus(summary);

  return {
    status,
    summary,
    issues: allIssues,
    parsed,
    reachability: reachabilityReport,
  };
}

function summarize(
  issues: Issue[],
  parsed: ReturnType<typeof parse>,
): ValidationReport["summary"] {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors += 1;
    else if (issue.severity === "warning") warnings += 1;
    else infos += 1;
  }
  let links = 0;
  for (const section of parsed.sections) {
    links += section.links.length;
  }
  return {
    errors,
    warnings,
    infos,
    sections: parsed.sections.length,
    links,
  };
}

function deriveStatus(summary: ValidationReport["summary"]): ValidationStatus {
  if (summary.errors > 0) return "fail";
  if (summary.warnings > 0) return "pass_with_warnings";
  return "pass";
}
