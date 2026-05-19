# Contributing to llms-txt-validator

Thanks for considering a contribution. This guide covers how to file issues, propose changes, and the conventions the project follows.

## Quick orientation

- **Language:** TypeScript (strict mode).
- **Runtime:** Node 18+ (uses native `fetch`).
- **Build tool:** [tsup](https://tsup.egoist.dev/).
- **Test runner:** [vitest](https://vitest.dev/).
- **No runtime dependencies.** Dev dependencies only. We keep the install footprint tiny because this validator gets pulled into CI pipelines.

## Local setup

```bash
git clone https://github.com/bridgetoagent/llms-txt-validator.git
cd llms-txt-validator
npm install
npm run test
npm run build
```

To test the CLI against a real file while developing:

```bash
npm run build
node ./dist/cli.js ./fixtures/example.txt
```

## Filing a bug

Open an issue with:

1. The **source** of the `llms.txt` you saw the issue with — paste the relevant lines, or link to a public URL we can fetch.
2. The **observed** output from the validator (CLI or library).
3. The **expected** behavior, and ideally a citation from [llmstxt.org](https://llmstxt.org) backing your expectation.

If the bug is "we wrongly flagged a valid file" or "we missed a real problem in a file", a one-line reproducer in a test case is the fastest path to a fix.

## Filing a feature request

Open an issue first before sending a PR for new checks. The validator is opinionated about scope — we cover spec conformance + link health, not content quality or semantic analysis. New issue codes have to:

- Map to a behavior that's checkable without judgment (no LLM calls, no heuristic gray-area)
- Either reflect the spec or reflect what AI agents practically need
- Be implementable in <50 lines + 3 tests

If your proposed check doesn't meet those, it might belong in a downstream tool that *consumes* the parsed structure (`parse()` is exported for exactly this reason).

## Making a change

1. Open an issue, or comment on an existing one, before doing significant work.
2. Branch off `main`.
3. Add a **test first** — at minimum a regression case for whatever you're changing.
4. Make the change.
5. Run `npm run lint && npm run test && npm run build` locally. All three must pass.
6. Open a PR with:
   - A reference to the issue
   - A short rationale (what / why)
   - A note on whether the change adds a new public API surface (new issue code, new export, etc.)

We aim to review within a week. If it's been longer, nudge with a polite comment on the PR — we may have missed the notification.

## Coding conventions

- **TypeScript strict.** `noUncheckedIndexedAccess` is on; handle the `| undefined` cases.
- **No mutation.** Build new objects / arrays rather than mutating in place. The parser builds the AST top-down.
- **Permissive parser, strict reporter.** We try to parse what we can rather than halt at the first issue, then report findings. This matches real-world `llms.txt` files which are often imperfect.
- **Pure functions where possible.** `parse()` and the validation routines are pure. `checkReachability()` is the only thing that does I/O.
- **Stable issue codes.** Once an issue code ships, we don't rename it. Add new codes; don't break old ones.

## Releases

Maintainers cut releases via:

1. Bump version in `package.json` (semver).
2. `git tag v$VERSION && git push --tags`.
3. `npm publish --access public` — `prepublishOnly` script runs lint + tests + build.

We don't auto-release on every merge. Multiple PRs may batch into one release.

## Code of conduct

Be kind, be specific, and assume good intent. We don't have a formal CoC document because the project is small enough that the rule above covers it. If something feels off, email `hello@bridgetoagent.com`.

## License

By contributing you agree that your contributions will be licensed under the same [MIT License](./LICENSE) as the rest of the project.
