import { describe, it, expect } from "vitest";
import { parse } from "./parser.js";

describe("parser — title detection", () => {
  it("captures a simple title", () => {
    const doc = parse("# Example");
    expect(doc.title).toBe("Example");
    expect(doc.titleLine).toBe(1);
    expect(doc.parseIssues.find((i) => i.code === "missing-title")).toBeUndefined();
  });

  it("trims whitespace around the title", () => {
    const doc = parse("#   Example with spaces   ");
    expect(doc.title).toBe("Example with spaces");
  });

  it("reports missing title", () => {
    const doc = parse("Some content without a heading.");
    expect(doc.title).toBe("");
    expect(doc.titleLine).toBeNull();
    expect(doc.parseIssues.some((i) => i.code === "missing-title")).toBe(true);
  });

  it("reports duplicate title", () => {
    const doc = parse("# First\n\n# Second");
    expect(doc.title).toBe("First");
    expect(doc.parseIssues.some((i) => i.code === "duplicate-title")).toBe(true);
  });

  it("reports H2 appearing before any H1", () => {
    const doc = parse("## Section\n# Title");
    // Title-not-h1 fires when a non-H1 heading appears first.
    expect(doc.parseIssues.some((i) => i.code === "title-not-h1")).toBe(true);
  });

  it("reports content appearing before the title", () => {
    const doc = parse("Intro paragraph.\n# Title");
    expect(doc.parseIssues.some((i) => i.code === "title-not-first")).toBe(true);
  });

  it("skips leading blank lines without complaining", () => {
    const doc = parse("\n\n\n# Title");
    expect(doc.title).toBe("Title");
    expect(doc.parseIssues.some((i) => i.code === "title-not-first")).toBe(false);
  });
});

describe("parser — description blockquote", () => {
  it("captures a single-line blockquote as description", () => {
    const doc = parse("# Title\n\n> A short description.");
    expect(doc.description).toBe("A short description.");
  });

  it("merges multi-line blockquotes", () => {
    const doc = parse("# Title\n\n> First line.\n> Second line.");
    expect(doc.description).toBe("First line. Second line.");
  });

  it("does not capture blockquotes that come after a section", () => {
    const doc = parse("# Title\n\n## Section\n\n- [a](https://a.example)\n\n> Late quote.");
    expect(doc.description).toBeUndefined();
  });
});

describe("parser — sections + bullets", () => {
  it("parses a simple section with one link", () => {
    const doc = parse(`# Title

## Docs

- [Getting started](https://example.com/start)`);
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.title).toBe("Docs");
    expect(doc.sections[0]!.links).toHaveLength(1);
    expect(doc.sections[0]!.links[0]).toMatchObject({
      text: "Getting started",
      url: "https://example.com/start",
    });
  });

  it("captures description tail after colon", () => {
    const doc = parse(`# T
## S
- [a](https://a.example): The first one`);
    expect(doc.sections[0]!.links[0]!.description).toBe("The first one");
  });

  it("supports asterisk bullets too", () => {
    const doc = parse(`# T
## S
* [a](https://a.example)`);
    expect(doc.sections[0]!.links).toHaveLength(1);
  });

  it("preserves multiple sections in order", () => {
    const doc = parse(`# T
## First
- [a](https://a.example)
## Second
- [b](https://b.example)`);
    expect(doc.sections.map((s) => s.title)).toEqual(["First", "Second"]);
  });

  it("warns on empty sections", () => {
    const doc = parse(`# T
## Empty
## NotEmpty
- [a](https://a.example)`);
    const empty = doc.parseIssues.filter((i) => i.code === "empty-section");
    expect(empty).toHaveLength(1);
    expect(empty[0]!.message).toContain("Empty");
  });

  it("reports malformed bullet lines", () => {
    const doc = parse(`# T
## S
- this is not a link`);
    expect(doc.parseIssues.some((i) => i.code === "malformed-link")).toBe(true);
  });

  it("reports H3+ headings as info", () => {
    const doc = parse(`# T
### Too deep`);
    expect(doc.parseIssues.some((i) => i.code === "section-wrong-level")).toBe(true);
  });
});

describe("parser — link URL checks", () => {
  it("flags relative URLs", () => {
    const doc = parse(`# T
## S
- [home](/docs)`);
    expect(doc.parseIssues.some((i) => i.code === "link-relative-url")).toBe(true);
  });

  it("flags URLs missing scheme as malformed", () => {
    const doc = parse(`# T
## S
- [bare](example.com/foo)`);
    expect(doc.parseIssues.some((i) => i.code === "malformed-link")).toBe(true);
  });

  it("flags http:// links as non-https warning", () => {
    const doc = parse(`# T
## S
- [insecure](http://example.com)`);
    expect(doc.parseIssues.some((i) => i.code === "link-non-https")).toBe(true);
  });

  it("flags fragment-only URLs", () => {
    const doc = parse(`# T
## S
- [anchor](#thing)`);
    expect(doc.parseIssues.some((i) => i.code === "link-hash-only")).toBe(true);
  });

  it("flags mailto URLs", () => {
    const doc = parse(`# T
## S
- [contact](mailto:a@example.com)`);
    expect(doc.parseIssues.some((i) => i.code === "link-mailto")).toBe(true);
  });

  it("accepts well-formed https URLs without complaint", () => {
    const doc = parse(`# T
## S
- [ok](https://example.com)`);
    const linkIssues = doc.parseIssues.filter(
      (i) =>
        i.code === "link-relative-url" ||
        i.code === "link-non-https" ||
        i.code === "malformed-link" ||
        i.code === "link-hash-only",
    );
    expect(linkIssues).toHaveLength(0);
  });

  it("flags duplicate URLs", () => {
    const doc = parse(`# T
## S
- [a](https://example.com)
- [b](https://example.com)`);
    expect(doc.parseIssues.some((i) => i.code === "duplicate-url")).toBe(true);
  });

  it("flags duplicate link text as info", () => {
    const doc = parse(`# T
## S
- [Docs](https://a.example)
- [Docs](https://b.example)`);
    expect(doc.parseIssues.some((i) => i.code === "duplicate-link-text")).toBe(true);
  });

  it("flags empty link text", () => {
    const doc = parse(`# T
## S
- [](https://a.example)`);
    expect(doc.parseIssues.some((i) => i.code === "link-empty-text")).toBe(true);
  });
});

describe("parser — minor formatting checks", () => {
  it("flags trailing whitespace", () => {
    const doc = parse("# Title   ");
    expect(doc.parseIssues.some((i) => i.code === "trailing-whitespace")).toBe(true);
  });

  it("flags tabs", () => {
    const doc = parse("# T\n## S\n-\t[a](https://a.example)");
    expect(doc.parseIssues.some((i) => i.code === "tabs-instead-of-spaces")).toBe(true);
  });

  it("warns when document has only a title", () => {
    const doc = parse("# Just a title");
    expect(doc.parseIssues.some((i) => i.code === "no-content-after-title")).toBe(true);
  });
});

describe("parser — line numbers", () => {
  it("records correct line numbers for links", () => {
    const source = ["# Title", "", "## Docs", "", "- [a](https://a.example)", "- [b](https://b.example)"].join(
      "\n",
    );
    const doc = parse(source);
    expect(doc.sections[0]!.links[0]!.line).toBe(5);
    expect(doc.sections[0]!.links[1]!.line).toBe(6);
  });

  it("records correct line number for section heading", () => {
    const source = ["# Title", "", "", "## Docs"].join("\n");
    const doc = parse(source);
    expect(doc.sections[0]!.line).toBe(4);
  });
});
