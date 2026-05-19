import { describe, it, expect } from "vitest";
import { validate } from "./index.js";

describe("integration — end-to-end validate()", () => {
  it("returns pass for a well-formed llms.txt", async () => {
    const source = `# Acme Docs

> Official documentation for Acme's products and services.

## Reference

- [API reference](https://docs.acme.com/api): JSON-RPC + REST endpoints
- [SDK](https://docs.acme.com/sdk)

## Optional

- [Blog](https://blog.acme.com)
`;
    const report = await validate(source);
    expect(report.status).toBe("pass");
    expect(report.summary.sections).toBe(2);
    expect(report.summary.links).toBe(3);
    expect(report.summary.errors).toBe(0);
  });

  it("returns fail when title is missing", async () => {
    const report = await validate("Just some content.");
    expect(report.status).toBe("fail");
    expect(report.summary.errors).toBeGreaterThan(0);
  });

  it("returns pass_with_warnings when only warnings present", async () => {
    const source = `# Title

## Docs

- [a](https://a.example)
- [b](https://a.example)
`;
    const report = await validate(source);
    expect(report.status).toBe("pass_with_warnings");
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBeGreaterThan(0);
  });

  it("includes parsed structure in the report", async () => {
    const source = `# Title

## Docs

- [A](https://a.example)
`;
    const report = await validate(source);
    expect(report.parsed.title).toBe("Title");
    expect(report.parsed.sections).toHaveLength(1);
  });

  it("runs reachability when enabled, skips by default", async () => {
    const source = `# T
## S
- [a](https://example.com)
`;
    const offline = await validate(source);
    expect(offline.reachability).toBeUndefined();

    // Provide a controlled fetch so we never hit the network in tests.
    const fetchImpl = (async () => new Response(null, { status: 200 })) as typeof fetch;
    const online = await validate(source, { checkReachability: true, fetchImpl });
    expect(online.reachability).toBeDefined();
    expect(online.reachability!.checked).toBe(1);
  });

  it("handles an empty file", async () => {
    const report = await validate("");
    expect(report.status).toBe("fail");
    expect(report.summary.errors).toBeGreaterThan(0);
  });

  it("handles CRLF line endings", async () => {
    const source = "# Title\r\n\r\n## Docs\r\n\r\n- [a](https://a.example)\r\n";
    const report = await validate(source);
    expect(report.status).toBe("pass");
    expect(report.summary.sections).toBe(1);
    expect(report.summary.links).toBe(1);
  });

  it("status banner shape", async () => {
    const report = await validate("# T\n## S\n- [a](https://a.example)");
    expect(report.summary).toMatchObject({
      sections: 1,
      links: 1,
    });
    expect(["pass", "pass_with_warnings", "fail"]).toContain(report.status);
  });
});
