# llms-txt-validator

Validator for [llms.txt](https://llmstxt.org) — checks parser conformance against the reference spec, link reachability, and missing or malformed sections.

Ships as:

- A **hosted web tool** at [bridgetoagent.com/tools/llms-txt-validator](https://www.bridgetoagent.com/tools/llms-txt-validator) — paste, upload, or fetch by URL. No signup, no email gate.
- A **CLI** for local files and CI pipelines.
- A **JavaScript / TypeScript library** for embedding in your own validation flow.

MIT licensed. No telemetry. No external dependencies beyond `fetch`.

---

## Install

```bash
npm install --save-dev @bridgetoagent-com/llms-txt-validator
# or
pnpm add -D @bridgetoagent-com/llms-txt-validator
# or
yarn add -D @bridgetoagent-com/llms-txt-validator
```

Requires Node 18 or newer (uses the native `fetch` API).

---

## Quick start

### CLI

```bash
# Validate a local file
npx @bridgetoagent-com/llms-txt-validator ./llms.txt

# Fetch and validate from a URL
npx @bridgetoagent-com/llms-txt-validator https://example.com/llms.txt

# Also verify every link is reachable
npx @bridgetoagent-com/llms-txt-validator ./llms.txt --check-links

# Machine-readable output for CI
npx @bridgetoagent-com/llms-txt-validator ./llms.txt --json
```

Exit codes:

| Code | Meaning |
| ---- | ------- |
| `0`  | Valid (status: `pass`) |
| `1`  | Warnings only (status: `pass_with_warnings`) |
| `2`  | Errors found (status: `fail`) |
| `64` | Bad command-line usage |
| `66` | Could not read input |

### Library

```ts
import { validate } from "@bridgetoagent-com/llms-txt-validator";

const source = await fs.readFile("./llms.txt", "utf8");
const report = await validate(source);

console.log(report.status);     // "pass" | "pass_with_warnings" | "fail"
console.log(report.summary);    // { errors, warnings, infos, sections, links }
console.log(report.issues);     // [{ severity, code, message, line, ... }, ...]
console.log(report.parsed);     // parsed document tree
```

Enable reachability checking:

```ts
const report = await validate(source, {
  checkReachability: true,
  concurrency: 8,       // default
  timeoutMs: 5000,      // default
  slowThresholdMs: 3000 // default
});

console.log(report.reachability); // { checked, failed, slow }
```

Parser only (no validation, no I/O):

```ts
import { parse } from "@bridgetoagent-com/llms-txt-validator";

const doc = parse(source);
// doc.title, doc.description, doc.sections[].links, etc.
```

---

## What gets checked

### Structure (always on)

- `# Title` is present and is the first non-blank content
- No duplicate H1 headings
- Optional `> blockquote` description captured immediately after the title
- `## Section` headings used for resource groups (H2 level)
- H3+ headings flagged (info — uncommon in llms.txt)
- Empty sections flagged

### Link bullets

- `- [text](url)` or `- [text](url): description` syntax
- Malformed Markdown links flagged
- Empty link text or URL
- Relative URLs (`/docs/foo`) — llms.txt is consumed by external agents, must be absolute
- Fragment-only URLs (`#anchor`)
- `mailto:` URLs flagged as unusual
- `http://` URLs flagged (prefer `https://`)
- Duplicate URLs (warning) and duplicate link text (info)

### Reachability (opt-in)

Pass `--check-links` (CLI) or `{ checkReachability: true }` (library) to enable network checks:

- Bounded-concurrency HEAD requests against every link
- Falls back to GET when HEAD returns 405 or 501
- `link-non-2xx` for 4xx/5xx responses
- `link-unreachable` for network errors and timeouts
- `link-slow` warning for links above the slow threshold (default 3s)

User-agent: `bridgetoagent-llms-txt-validator/0.1 (+https://github.com/bridgetoagent/llms-txt-validator)` — identifies itself so server logs aren't anonymous.

---

## Issue codes

Stable identifiers for every kind of finding — pin on these in CI or tooling.

| Code | Severity | Meaning |
| ---- | -------- | ------- |
| `missing-title` | error | No `# Title` heading found |
| `title-not-first` | error | Content appears before the title |
| `title-not-h1` | error | First heading is not H1 |
| `duplicate-title` | warning | Multiple H1 headings |
| `section-wrong-level` | info | H3+ heading where H2 is conventional |
| `empty-section` | warning | Section has no link bullets |
| `malformed-link` | error | Bullet line is not a valid Markdown link |
| `link-missing-url` | error | Link `[text]()` has no URL |
| `link-empty-text` | warning | Link `[](url)` has no display text |
| `link-relative-url` | warning | Root-relative URL — must be absolute |
| `link-hash-only` | warning | Fragment-only URL — meaningless to external agents |
| `link-mailto` | info | `mailto:` URL — unusual in llms.txt |
| `link-non-https` | warning | `http://` — prefer `https://` |
| `duplicate-url` | warning | Same URL appears more than once |
| `duplicate-link-text` | info | Same link text appears more than once |
| `link-unreachable` | error | Network error or timeout (reachability mode) |
| `link-non-2xx` | error | HTTP 4xx or 5xx response (reachability mode) |
| `link-slow` | warning | Response slower than threshold (reachability mode) |
| `no-content-after-title` | warning | Title exists but nothing else |
| `trailing-whitespace` | info | Line has trailing whitespace |
| `tabs-instead-of-spaces` | info | Line contains tab characters |

---

## CI / pre-commit usage

### GitHub Actions

```yaml
- name: Validate llms.txt
  run: npx @bridgetoagent-com/llms-txt-validator ./public/llms.txt --check-links
```

### Husky / lint-staged

```json
{
  "lint-staged": {
    "public/llms.txt": "@bridgetoagent-com/llms-txt-validator"
  }
}
```

### Standalone script

```bash
#!/usr/bin/env bash
set -euo pipefail
npx @bridgetoagent-com/llms-txt-validator ./public/llms.txt --check-links --json > .llms-txt-report.json
```

---

## How this compares to other tools

This validator focuses on **conformance to the [llmstxt.org reference spec](https://llmstxt.org)** plus **link health**.

It does **not**:

- Generate `llms.txt` from a site's DOM (see [BridgeToAgent](https://www.bridgetoagent.com) for that)
- Score how *good* the content of your `llms.txt` is for any particular agent
- Crawl the URLs it references to validate the linked content

Generating a complete agent-readiness kit from your real site is a separate problem — that's what the BridgeToAgent kit at [bridgetoagent.com](https://www.bridgetoagent.com) does ($49, generates `agents.json` + `llms.txt` + `agent-instructions.md` together).

---

## Contributing

Bug reports, edge cases, and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Good first issues:

- Real-world `llms.txt` files we miss-parse (open an issue with the source URL)
- Additional issue codes for spec corner cases
- Performance improvements on large files

---

## License

[MIT](./LICENSE) — copyright 2026 BridgeToAgent editorial.

---

## See also

- The [llmstxt.org](https://llmstxt.org) reference specification
- BridgeToAgent's [agent-readiness blog coverage](https://www.bridgetoagent.com/blog)
- [The Lighthouse Agentic Browsing audit suite](https://www.bridgetoagent.com/blog/lighthouse-every-audit-every-fix), which includes the `llms-txt-well-formed` audit this validator helps you pass
