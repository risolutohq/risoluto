import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractFrontmatter } from "../../scripts/validate-research.js";

const PRDS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/prds");

/** Frontmatter is keyed YAML scalars; the regression is about CR leaking into the values. */
type Frontmatter = Record<string, unknown>;

const LF_DOC = ["---", "status: draft", "slug: foo", "---", "", "# Body", ""].join("\n");

describe("extractFrontmatter line-ending normalization", () => {
  it("strips trailing CR from CRLF frontmatter so scalars match enums (regression)", () => {
    // Windows / core.autocrlf=true checkout: every line ends \r\n. Pre-fix this
    // parsed `status` as "draft\r", which failed prd.schema.json's status enum.
    const crlf = LF_DOC.replace(/\n/g, "\r\n");
    const fm = extractFrontmatter(crlf) as Frontmatter;

    expect(fm.status).toBe("draft");
    expect(fm.slug).toBe("foo");
    for (const value of Object.values(fm)) {
      expect(String(value)).not.toMatch(/\r/);
    }
  });

  it("handles lone-CR (classic-Mac) endings as well", () => {
    const cr = LF_DOC.replace(/\n/g, "\r");
    const fm = extractFrontmatter(cr) as Frontmatter;

    expect(fm.status).toBe("draft");
    expect(fm.slug).toBe("foo");
  });

  it("leaves LF frontmatter unchanged", () => {
    const fm = extractFrontmatter(LF_DOC) as Frontmatter;

    expect(fm.status).toBe("draft");
    expect(fm.slug).toBe("foo");
  });

  it("still rejects missing and unterminated frontmatter", () => {
    expect(() => extractFrontmatter("no frontmatter here")).toThrow(/missing YAML frontmatter/);
    expect(() => extractFrontmatter("---\r\nstatus: draft\r\nstill going")).toThrow(/unterminated YAML frontmatter/);
  });

  it("parses every real PRD with clean (CR-free) scalars under a CRLF checkout", () => {
    const prdNames = readdirSync(PRDS_DIR).filter((name) => name.endsWith(".md") && name !== "README.md");
    expect(prdNames.length).toBeGreaterThan(0);

    for (const name of prdNames) {
      const lf = readFileSync(path.join(PRDS_DIR, name), "utf8").replace(/\r\n?/g, "\n");
      const crlf = lf.replace(/\n/g, "\r\n");
      const fm = extractFrontmatter(crlf) as Frontmatter;

      expect(fm.slug, `${name} slug should match filename`).toBe(name.replace(/\.md$/, ""));
      for (const [key, value] of Object.entries(fm)) {
        if (typeof value === "string") {
          expect(value, `${name} frontmatter "${key}" must not retain a CR`).not.toMatch(/\r/);
        }
      }
    }
  });
});
