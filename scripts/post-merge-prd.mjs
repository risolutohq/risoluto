#!/usr/bin/env node
/**
 * Post-merge PRD automation: flip PRD status to shipped + back-comment Linear issues.
 *
 * Phase 4.3 of docs/planning-pipeline-roadmap.md.
 *
 * Usage:
 *   node scripts/post-merge-prd.mjs <prd-slug> \
 *     --pr-url <url> --pr-number <number> --merge-commit <sha>
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");
const LINEAR_ENDPOINT = process.env.LINEAR_API_ENDPOINT ?? "https://api.linear.app/graphql";

function fail(message) {
  console.error(`post-merge-prd: ${message}`);
  process.exit(1);
}

function log(message) {
  console.error(`post-merge-prd: ${message}`);
}

function parseArgs(argv) {
  const args = { slug: null, prUrl: null, prNumber: null, mergeCommit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--pr-url") args.prUrl = argv[++i];
    else if (a === "--pr-number") args.prNumber = argv[++i];
    else if (a === "--merge-commit") args.mergeCommit = argv[++i];
    else if (!a.startsWith("--") && args.slug == null) args.slug = a;
    else fail(`unknown argument: ${a}`);
  }
  if (!args.slug) fail("missing <prd-slug>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) fail(`invalid prd slug: ${args.slug}`);
  if (!args.prUrl) fail("missing --pr-url");
  if (!args.prNumber) fail("missing --pr-number");
  if (!args.mergeCommit) fail("missing --merge-commit");
  return args;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) throw new Error("missing YAML frontmatter");
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error("unterminated YAML frontmatter");
  return { fm: parseYaml(raw.slice(3, end).replace(/^\r?\n/, "")) ?? {}, body: raw.slice(end + 4).replace(/^\r?\n/, "") };
}

function renderFrontmatter(fm, body) {
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n${body}`;
}

async function linearGraphQL(query, variables) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    fail("LINEAR_API_KEY not set");
  }

  const response = await fetch(LINEAR_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Linear API returned ${response.status}: ${body}`);
  }

  const payload = await response.json();

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${payload.errors.map((e) => e.message).join(", ")}`);
  }

  return payload.data;
}

const FIND_LABEL_QUERY = `
  query FindLabel($name: String!) {
    issueLabels(filter: { name: { eq: $name } }) {
      nodes {
        id
        name
      }
    }
  }
`;

const FIND_ISSUES_BY_LABEL_QUERY = `
  query FindIssuesByLabel($labelId: String!) {
    issues(filter: { labels: { id: { eq: $labelId } } }) {
      nodes {
        id
        identifier
        title
      }
    }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment {
        id
      }
    }
  }
`;

async function findIssuesWithLabel(slug) {
  const labelName = `from:prd-${slug}`;

  const labelData = await linearGraphQL(FIND_LABEL_QUERY, { name: labelName });
  const labelNodes = labelData?.issueLabels?.nodes ?? [];
  const label = labelNodes[0];

  if (!label) {
    log(`no Linear label found: "${labelName}" — skipping issue comments`);
    return [];
  }

  const issuesData = await linearGraphQL(FIND_ISSUES_BY_LABEL_QUERY, { labelId: label.id });
  const issues = issuesData?.issues?.nodes ?? [];

  if (issues.length === 0) {
    log(`no Linear issues found with label "${labelName}"`);
  }

  return issues;
}

async function commentOnIssue(issueId, comment) {
  const data = await linearGraphQL(COMMENT_CREATE_MUTATION, { issueId, body: comment });
  const success = data?.commentCreate?.success ?? false;
  if (!success) {
    throw new Error(`commentCreate returned success=false for issue ${issueId}`);
  }
  return data.commentCreate.comment?.id;
}

function flipPrdStatus(slug) {
  const prdPath = path.join(PRDS_DIR, `${slug}.md`);
  if (!existsSync(prdPath)) {
    fail(`PRD file not found: ${path.relative(REPO_ROOT, prdPath)}`);
  }

  const raw = readFileSync(prdPath, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const previousStatus = fm.status ?? "(unset)";

  if (fm.status === "shipped") {
    log(`PRD ${slug} already has status: shipped — no change needed`);
    return { prdPath, previousStatus, changed: false };
  }

  const updated = { ...fm, status: "shipped" };
  const out = renderFrontmatter(updated, body);
  writeFileSync(prdPath, out);

  log(`flipped ${path.relative(REPO_ROOT, prdPath)} status: ${previousStatus} → shipped`);
  return { prdPath, previousStatus, changed: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  log(`processing PRD: ${args.slug}`);
  log(`  PR: #${args.prNumber} (${args.prUrl})`);
  log(`  merge commit: ${args.mergeCommit}`);

  // Step 1: Flip PRD status to shipped
  const { prdPath, previousStatus, changed } = flipPrdStatus(args.slug);

  // Step 2: Find Linear issues and post comments
  const issues = await findIssuesWithLabel(args.slug);
  const commentBody = `Merged in PR #${args.prNumber}: ${args.prUrl} (commit: ${args.mergeCommit})`;

  let commented = 0;
  let commentErrors = 0;

  for (const issue of issues) {
    try {
      const commentId = await commentOnIssue(issue.id, commentBody);
      log(`  commented on ${issue.identifier} (${issue.title}) — comment ${commentId}`);
      commented += 1;
    } catch (error) {
      log(`  failed to comment on ${issue.identifier}: ${error instanceof Error ? error.message : String(error)}`);
      commentErrors += 1;
    }
  }

  // Summary
  log("---");
  log("summary:");
  log(`  PRD status: ${previousStatus} → shipped (${changed ? "changed" : "already shipped"})`);
  log(`  Linear issues commented: ${commented}/${issues.length}`);
  if (commentErrors > 0) {
    log(`  Linear comment errors: ${commentErrors}`);
  }

  if (commentErrors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  log(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
