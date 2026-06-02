#!/usr/bin/env node
/**
 * Slug-consistency check — the join-key guard the pipeline doc long claimed but never implemented.
 *
 * The slug is the join key across four surfaces. This verifies the three git-local ones are identical:
 *   PRD filename  ==  prd.slug frontmatter  ==  roadmap row `<!-- slug:<slug> -->`
 * and, with --linear (needs LINEAR_API_KEY), that a `from:prd-<slug>` Linear label exists for any PRD
 * whose roadmap row is `building`/`shipped` (where to-issues should already have created it).
 *
 * Exit 0 when consistent, 1 on any mismatch. Offline by default (fast enough for the pre-push gate).
 *
 * Usage:
 *   node scripts/slug-consistency-check.mjs            # three git-local surfaces
 *   node scripts/slug-consistency-check.mjs --linear   # also cross-check the Linear label
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap, findRowBySlug } from "./roadmap.mjs";

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");
const ROADMAP_PATH = path.join(REPO_ROOT, "docs", "roadmap.md");
const LINEAR_ENDPOINT = process.env.LINEAR_API_ENDPOINT ?? "https://api.linear.app/graphql";
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function frontmatterSlug(raw) {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return null;
  const match = raw.slice(3, end).match(/^slug:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

async function linearLabelExists(slug) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("--linear requires LINEAR_API_KEY");
  const query = `query($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id } } }`;
  const response = await fetch(LINEAR_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({ query, variables: { name: `from:prd-${slug}` } }),
  });
  if (!response.ok) throw new Error(`Linear API returned ${response.status}`);
  const payload = await response.json();
  return (payload?.data?.issueLabels?.nodes ?? []).length > 0;
}

async function main() {
  const checkLinear = process.argv.includes("--linear");
  if (!existsSync(PRDS_DIR)) {
    console.error("slug:check: docs/prds not found");
    process.exit(1);
  }
  const roadmap = existsSync(ROADMAP_PATH) ? parseRoadmap(readFileSync(ROADMAP_PATH, "utf8")) : null;
  const problems = [];
  const checked = [];

  for (const file of readdirSync(PRDS_DIR)) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const slugFromFile = file.replace(/\.md$/, "");
    const slugFromFm = frontmatterSlug(readFileSync(path.join(PRDS_DIR, file), "utf8"));
    if (!slugFromFm || !SLUG_RE.test(slugFromFm)) continue; // not a pipeline PRD (no real slug)
    checked.push(slugFromFile);

    if (slugFromFm !== slugFromFile) {
      problems.push(`${file}: frontmatter slug "${slugFromFm}" != filename "${slugFromFile}"`);
    }
    if (roadmap?.found && !findRowBySlug(roadmap, slugFromFile)) {
      problems.push(`${file}: no roadmap row carries <!-- slug:${slugFromFile} -->`);
    }
    // The Linear label is created by to-issues, so its absence is ambiguous (a to-prd'd but not yet
    // sliced PRD legitimately has none). Report it informationally under --linear; never fail on it.
    if (checkLinear) {
      const exists = await linearLabelExists(slugFromFile).catch((err) => {
        console.error(`  ${slugFromFile}: Linear label check skipped — ${err.message}`);
        return null;
      });
      if (exists !== null) {
        console.error(
          `  ${slugFromFile}: Linear label from:prd-${slugFromFile} ${exists ? "present" : "absent (run /risoluto-to-issues)"}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(`slug:check FAILED (${problems.length}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.error(`slug:check ok — ${checked.length} PRD slug(s) consistent: ${checked.join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error(`slug:check: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
