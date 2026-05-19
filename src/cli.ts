#!/usr/bin/env node
/**
 * CLI wrapper for @bridgetoagent-com/llms-txt-validator.
 *
 * Usage:
 *   llms-txt-validator <path-or-url> [--check-links] [--json]
 *
 * Examples:
 *   llms-txt-validator ./llms.txt
 *   llms-txt-validator ./llms.txt --check-links
 *   llms-txt-validator https://example.com/llms.txt --check-links
 *   llms-txt-validator ./llms.txt --json > report.json
 */

import { readFile } from "node:fs/promises";
import { argv, exit, stderr, stdout } from "node:process";
import { validate } from "./index.js";
import type { Issue, ValidationReport } from "./types.js";

interface CliArgs {
  target: string;
  checkLinks: boolean;
  json: boolean;
  showHelp: boolean;
  showVersion: boolean;
}

const VERSION = "0.1.0";

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {
    target: "",
    checkLinks: false,
    json: false,
    showHelp: false,
    showVersion: false,
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") out.showHelp = true;
    else if (arg === "--version" || arg === "-v") out.showVersion = true;
    else if (arg === "--check-links") out.checkLinks = true;
    else if (arg === "--json") out.json = true;
    else if (!arg.startsWith("-") && out.target === "") out.target = arg;
  }
  return out;
}

function printHelp(): void {
  const help = `
llms-txt-validator — validate llms.txt against the llmstxt.org reference spec

USAGE
  llms-txt-validator <path-or-url> [options]

OPTIONS
  --check-links    Make HEAD requests to every link and report unreachable URLs.
                   Off by default (no network I/O).
  --json           Output a machine-readable JSON report instead of human prose.
  -v, --version    Print version and exit.
  -h, --help       Show this help.

EXAMPLES
  llms-txt-validator ./llms.txt
  llms-txt-validator ./llms.txt --check-links
  llms-txt-validator https://example.com/llms.txt
  llms-txt-validator ./llms.txt --json > report.json

EXIT CODES
  0    File is valid (status: pass).
  1    File has warnings but no errors (status: pass_with_warnings).
  2    File has errors (status: fail).
  64   Bad command-line usage.
  66   Input file or URL could not be read.

DOCS
  https://github.com/bridgetoagent/llms-txt-validator
  https://www.bridgetoagent.com/tools/llms-txt-validator
`;
  stdout.write(`${help.trim()}\n`);
}

async function loadSource(target: string): Promise<string> {
  if (/^https?:\/\//i.test(target)) {
    const response = await fetch(target);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${target}`);
    }
    return await response.text();
  }
  return await readFile(target, "utf8");
}

function renderHuman(report: ValidationReport, target: string): string {
  const lines: string[] = [];
  lines.push(`Source: ${target}`);
  lines.push("");
  lines.push(statusBanner(report));
  lines.push("");
  lines.push(
    `Sections: ${report.summary.sections}    Links: ${report.summary.links}    Errors: ${report.summary.errors}    Warnings: ${report.summary.warnings}    Info: ${report.summary.infos}`,
  );
  if (report.reachability) {
    const r = report.reachability;
    lines.push(`Reachability: ${r.checked} checked, ${r.failed} failed, ${r.slow} slow`);
  }
  lines.push("");

  if (report.issues.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  // Group by severity then preserve insertion order.
  const groups: Record<"error" | "warning" | "info", Issue[]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const issue of report.issues) {
    groups[issue.severity].push(issue);
  }
  for (const severity of ["error", "warning", "info"] as const) {
    const list = groups[severity];
    if (list.length === 0) continue;
    lines.push(`--- ${severity.toUpperCase()} (${list.length}) ---`);
    for (const issue of list) {
      const locator = issue.line !== undefined ? `line ${issue.line}: ` : "";
      lines.push(`  [${issue.code}] ${locator}${issue.message}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function statusBanner(report: ValidationReport): string {
  if (report.status === "pass") return "STATUS: pass";
  if (report.status === "pass_with_warnings") return "STATUS: pass with warnings";
  return "STATUS: fail";
}

function statusExit(report: ValidationReport): number {
  if (report.status === "pass") return 0;
  if (report.status === "pass_with_warnings") return 1;
  return 2;
}

async function main(): Promise<number> {
  const args = parseArgs(argv.slice(2));

  if (args.showHelp || (!args.target && !args.showVersion)) {
    if (!args.target && !args.showHelp) {
      stderr.write("error: missing <path-or-url>\n\n");
      printHelp();
      return 64;
    }
    printHelp();
    return 0;
  }

  if (args.showVersion) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  let source: string;
  try {
    source = await loadSource(args.target);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`error: could not read ${args.target}: ${message}\n`);
    return 66;
  }

  const report = await validate(source, { checkReachability: args.checkLinks });

  if (args.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(`${renderHuman(report, args.target)}\n`);
  }

  return statusExit(report);
}

main().then(
  (code) => exit(code),
  (err) => {
    stderr.write(`unexpected: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(70);
  },
);
