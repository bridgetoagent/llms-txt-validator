import type { Issue, ParsedDocument, ParsedLink, ParsedSection } from "./types.js";

/**
 * Pure parser for llms.txt content per the llmstxt.org reference spec.
 *
 * Behavior:
 *   - First non-empty line MUST be `# Title` (H1). If anything else appears
 *     first (intro text, a different heading level), we still parse what we
 *     can but record a structural issue.
 *   - Optional `> blockquote` directly after the title becomes the description.
 *   - Free-form content lines between the title block and the first `## Section`
 *     are captured as introContent.
 *   - Each `## Section` collects bullet lines `- [text](url)` or
 *     `- [text](url): description`. Malformed lines record issues but do not
 *     halt parsing.
 *
 * The parser is line-based + permissive. It does NOT run Markdown through a
 * full parser — llms.txt is a constrained subset and a regex-based approach
 * gives us precise line/column reporting that a full Markdown parser obscures.
 */

const TITLE_RE = /^#\s+(.+?)\s*$/;
const SECTION_RE = /^##\s+(.+?)\s*$/;
const ANY_HEADING_RE = /^(#{1,6})\s+/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
/**
 * Bullet line: optional whitespace, `-` or `*`, space, then `[text](url)` with
 * optional `: description` tail. Captures (text, url, description).
 */
const BULLET_LINK_RE = /^\s*[-*]\s+\[([^\]]*)\]\(([^)\s]+)\)(?:\s*[:：]\s*(.+?))?\s*$/;
/** Bullet line that looks like a list item but the link inside is malformed. */
const BULLET_GENERIC_RE = /^\s*[-*]\s+(.*)$/;

export function parse(source: string): ParsedDocument {
  const issues: Issue[] = [];
  const lines = source.split(/\r?\n/);

  let title = "";
  let titleLine: number | null = null;
  let description: string | undefined;
  const introContentLines: string[] = [];
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  /** Whether we have started collecting intro content (i.e. seen the title). */
  let titleSeen = false;
  /** Whether we have already collected the description blockquote. */
  let descriptionCollected = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const lineNo = i + 1;
    const trimmed = raw.trim();

    // Catch trailing whitespace as info-level issue (non-blocking).
    // Use trimEnd so leading indentation (legitimate on bullet lines) doesn't
    // count toward the trailing-whitespace finding.
    if (raw !== raw.trimEnd() && raw.trim() !== "") {
      issues.push({
        severity: "info",
        code: "trailing-whitespace",
        message: "Line has trailing whitespace.",
        line: lineNo,
        raw,
      });
    }

    if (raw.includes("\t")) {
      issues.push({
        severity: "info",
        code: "tabs-instead-of-spaces",
        message: "Line contains tab characters; spaces are conventional in llms.txt.",
        line: lineNo,
        raw,
      });
    }

    // Skip blank lines, but use them to break out of description collection.
    if (trimmed === "") {
      descriptionCollected = description !== undefined ? true : descriptionCollected;
      continue;
    }

    // Title detection.
    const titleMatch = trimmed.match(TITLE_RE);
    if (titleMatch) {
      if (titleSeen) {
        issues.push({
          severity: "warning",
          code: "duplicate-title",
          message:
            "Multiple H1 headings found. The llms.txt spec expects a single `# Title` at the top.",
          line: lineNo,
          raw,
        });
        continue;
      }
      title = (titleMatch[1] ?? "").trim();
      titleLine = lineNo;
      titleSeen = true;
      continue;
    }

    // Detect a non-H1 heading appearing before the title.
    const anyHeadingMatch = !titleSeen && trimmed.match(ANY_HEADING_RE);
    if (anyHeadingMatch) {
      issues.push({
        severity: "error",
        code: "title-not-h1",
        message:
          "Document starts with a non-H1 heading. The first heading must be `# Title` per the llms.txt spec.",
        line: lineNo,
        raw,
      });
    }

    // If we haven't seen a title yet AND we're past blank lines, the title
    // isn't first.
    if (!titleSeen && trimmed !== "" && !trimmed.startsWith("#")) {
      issues.push({
        severity: "error",
        code: "title-not-first",
        message:
          "Content appears before the `# Title` line. The first non-blank line of llms.txt must be the H1 title.",
        line: lineNo,
        raw,
      });
      // Continue scanning so we still parse what comes later.
    }

    // Section detection.
    const sectionMatch = trimmed.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = {
        title: (sectionMatch[1] ?? "").trim(),
        line: lineNo,
        links: [],
      };
      sections.push(currentSection);
      continue;
    }

    // Lower-level headings inside the document — H3+ is permissible per spec
    // but rare; we report them as info so the user can verify it's intentional.
    const lowerHeadingMatch = trimmed.match(/^#{3,6}\s+/);
    if (lowerHeadingMatch) {
      issues.push({
        severity: "info",
        code: "section-wrong-level",
        message:
          "Heading deeper than H2 found. llms.txt sections are conventionally H2 (`##`).",
        line: lineNo,
        raw,
      });
      continue;
    }

    // Description: blockquote immediately after the title (and before any
    // other content / sections).
    if (
      titleSeen &&
      !descriptionCollected &&
      currentSection === null &&
      BLOCKQUOTE_RE.test(trimmed)
    ) {
      const quoteMatch = trimmed.match(BLOCKQUOTE_RE);
      const quoted = (quoteMatch?.[1] ?? "").trim();
      description = description ? `${description} ${quoted}` : quoted;
      continue;
    }

    // Bullet lines inside a section.
    if (currentSection !== null) {
      const bulletLink = trimmed.match(BULLET_LINK_RE);
      if (bulletLink) {
        const [, text, url, descriptionTail] = bulletLink;
        const link = collectLink({
          text: text ?? "",
          url: url ?? "",
          description: descriptionTail?.trim(),
          line: lineNo,
          raw,
          issues,
        });
        currentSection.links.push(link);
        continue;
      }

      const bulletGeneric = trimmed.match(BULLET_GENERIC_RE);
      if (bulletGeneric) {
        issues.push({
          severity: "error",
          code: "malformed-link",
          message:
            "Bullet line does not contain a well-formed Markdown link. Expected `- [text](url)` or `- [text](url): description`.",
          line: lineNo,
          raw,
        });
        continue;
      }

      // Non-bullet content inside a section — fine per spec (prose between
      // bullets is allowed) but we record nothing.
      continue;
    }

    // Free-form intro content (between title block and first section).
    if (titleSeen && currentSection === null) {
      introContentLines.push(raw);
    }
  }

  // After scan: was a title seen at all?
  if (!titleSeen) {
    issues.push({
      severity: "error",
      code: "missing-title",
      message:
        "No `# Title` heading found. Every llms.txt file must start with a single H1 title.",
    });
  }

  // Empty section detection.
  for (const section of sections) {
    if (section.links.length === 0) {
      issues.push({
        severity: "warning",
        code: "empty-section",
        message: `Section "${section.title}" contains no link bullets.`,
        line: section.line,
      });
    }
  }

  // No content after title (only title, no description, no sections, no body).
  if (titleSeen && sections.length === 0 && introContentLines.length === 0 && !description) {
    issues.push({
      severity: "warning",
      code: "no-content-after-title",
      message:
        "Document has only a title and no other content (no description, sections, or body).",
      line: titleLine ?? undefined,
    });
  }

  // Cross-document duplicate detection.
  const seenUrls = new Map<string, number>();
  const seenTexts = new Map<string, number>();
  for (const section of sections) {
    for (const link of section.links) {
      const normalizedUrl = link.url.trim();
      const firstSeenUrl = seenUrls.get(normalizedUrl);
      if (firstSeenUrl !== undefined && normalizedUrl !== "") {
        issues.push({
          severity: "warning",
          code: "duplicate-url",
          message: `URL "${normalizedUrl}" appears multiple times (first seen on line ${firstSeenUrl}).`,
          line: link.line,
        });
      } else {
        seenUrls.set(normalizedUrl, link.line);
      }

      const normalizedText = link.text.trim();
      const firstSeenText = seenTexts.get(normalizedText);
      if (firstSeenText !== undefined && normalizedText !== "") {
        issues.push({
          severity: "info",
          code: "duplicate-link-text",
          message: `Link text "${normalizedText}" appears multiple times (first seen on line ${firstSeenText}).`,
          line: link.line,
        });
      } else {
        seenTexts.set(normalizedText, link.line);
      }
    }
  }

  return {
    title,
    titleLine,
    description,
    introContent: introContentLines.join("\n").trim(),
    sections,
    parseIssues: issues,
  };
}

interface CollectLinkInput {
  text: string;
  url: string;
  description: string | undefined;
  line: number;
  raw: string;
  issues: Issue[];
}

function collectLink(input: CollectLinkInput): ParsedLink {
  const { text, url, description, line, raw, issues } = input;

  if (text.trim() === "") {
    issues.push({
      severity: "warning",
      code: "link-empty-text",
      message: "Link has empty display text.",
      line,
      raw,
    });
  }

  if (url.trim() === "") {
    issues.push({
      severity: "error",
      code: "link-missing-url",
      message: "Link has empty URL.",
      line,
      raw,
    });
  } else {
    // URL well-formedness checks.
    if (url.startsWith("#")) {
      issues.push({
        severity: "warning",
        code: "link-hash-only",
        message:
          "Link URL is a fragment (`#...`) — llms.txt is consumed by external agents and fragments lose meaning.",
        line,
        raw,
      });
    } else if (url.startsWith("mailto:")) {
      issues.push({
        severity: "info",
        code: "link-mailto",
        message: "Link is a `mailto:` URL — unusual in llms.txt resource lists.",
        line,
        raw,
      });
    } else if (url.startsWith("/")) {
      issues.push({
        severity: "warning",
        code: "link-relative-url",
        message:
          "Link is a root-relative URL. llms.txt is consumed by external agents — use absolute URLs (with scheme + host).",
        line,
        raw,
      });
    } else if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) {
      issues.push({
        severity: "error",
        code: "malformed-link",
        message: `URL "${url}" is missing a scheme (http:// or https://).`,
        line,
        raw,
      });
    } else if (url.startsWith("http://")) {
      issues.push({
        severity: "warning",
        code: "link-non-https",
        message:
          "Link uses http:// — prefer https:// so agents that refuse insecure fetches don't drop the link.",
        line,
        raw,
      });
    }
  }

  return {
    text: text.trim(),
    url: url.trim(),
    description: description?.trim(),
    line,
  };
}
