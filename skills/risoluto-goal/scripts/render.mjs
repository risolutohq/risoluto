#!/usr/bin/env node
/**
 * risoluto-goal: render a Codex /goal package from one PRD and its Linear waves.
 *
 * Usage:
 *   node skills/risoluto-goal/scripts/render.mjs <slug> [--force]
 *
 * Writes ~/.codex/goals/<slug>/{GOAL.md,SPEC.md,WAVES.md,CONTROL.md,PLAN.md,ATTEMPTS.md,NOTES.md}.
 * Uses LINEAR_API_KEY + GraphQL for the portable Codex path.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const PRDS_DIR = path.join(REPO_ROOT, "docs", "prds");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const GOAL_ROOT = path.join(os.homedir(), ".codex", "goals");
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

function fail(message) {
  console.error(`risoluto-goal: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const slug = argv.find((arg) => !arg.startsWith("--"));
  return { slug, force: argv.includes("--force") };
}

function assertSlug(slug) {
  if (!slug) fail("usage: render.mjs <slug> [--force]");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid PRD slug: ${slug}`);
}

function checkRepo() {
  if (!existsSync(path.join(REPO_ROOT, "package.json")) || !existsSync(path.join(REPO_ROOT, ".gitmodules"))) {
    fail(`run from the risoluto repo root; resolved root was ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git")) && !existsSync(path.join(RESEARCH_DIR, "README.md"))) {
    fail("research/ submodule is not initialised; run `git submodule update --init research`");
  }
}

function parseFrontmatter(raw, prdPath) {
  if (!raw.startsWith("---")) fail(`${prdPath} is missing YAML frontmatter`);
  const end = raw.indexOf("\n---", 3);
  if (end === -1) fail(`${prdPath} has unterminated YAML frontmatter`);
  const frontmatter = parseYaml(raw.slice(3, end).replace(/^\r?\n/, "")) ?? {};
  const bodyStart = raw.indexOf("\n", end + 3) + 1;
  return { frontmatter, body: raw.slice(bodyStart) };
}

function readPrd(slug) {
  const prdPath = path.join(PRDS_DIR, `${slug}.md`);
  if (!existsSync(prdPath)) fail(`PRD not found: docs/prds/${slug}.md; run /risoluto-to-prd ${slug} first`);

  const raw = readFileSync(prdPath, "utf8");
  const parsed = parseFrontmatter(raw, prdPath);
  if (!parsed.frontmatter.linear_project) {
    fail(`docs/prds/${slug}.md has no linear_project; run /risoluto-to-prd ${slug} first`);
  }

  return {
    path: path.relative(REPO_ROOT, prdPath),
    linearProjectUrl: String(parsed.frontmatter.linear_project),
    body: parsed.body,
  };
}

function extractProjectSlugId(linearProjectUrl) {
  try {
    const parts = new URL(linearProjectUrl).pathname.split("/").filter(Boolean);
    const projectIndex = parts.indexOf("project");
    if (projectIndex >= 0 && parts[projectIndex + 1]) return parts[projectIndex + 1];
  } catch {
    fail(`invalid linear_project URL: ${linearProjectUrl}`);
  }
  fail(`could not extract Linear project slug from ${linearProjectUrl}`);
}

async function linearRequest(query, variables) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) fail("LINEAR_API_KEY is not set; cannot derive waves");

  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    fail(JSON.stringify({ status: response.status, errors: payload.errors ?? payload }, null, 2));
  }
  return payload.data;
}

async function resolveProject(linearProjectUrl) {
  const slugId = extractProjectSlugId(linearProjectUrl);
  const data = await linearRequest(
    `query ProjectBySlug($slugId: String!) {
      projects(first: 1, filter: { slugId: { eq: $slugId } }) {
        nodes { id name url slugId }
      }
    }`,
    { slugId },
  );
  const project = data.projects.nodes[0];
  if (!project) fail(`Linear project not found for slugId ${slugId}`);
  return project;
}

function blockedByFromIssue(issue) {
  return issue.inverseRelations.nodes
    .filter((relation) => relation.type === "blocks")
    .map((relation) => ({
      identifier: relation.issue.identifier,
      title: relation.issue.title,
      state: relation.issue.state?.name ?? "Unknown",
    }))
    .sort(compareIdentifiers);
}

function compareIdentifiers(left, right) {
  const leftId = typeof left === "string" ? left : left.identifier;
  const rightId = typeof right === "string" ? right : right.identifier;
  const leftNumber = Number(leftId.match(/\d+$/)?.[0] ?? 0);
  const rightNumber = Number(rightId.match(/\d+$/)?.[0] ?? 0);
  return leftNumber - rightNumber || leftId.localeCompare(rightId);
}

function normalizeIssue(issue) {
  return {
    identifier: issue.identifier,
    title: issue.title,
    branchName: issue.branchName ?? "",
    url: issue.url ?? "",
    state: issue.state?.name ?? "Unknown",
    blockedBy: blockedByFromIssue(issue),
  };
}

async function fetchIssuesByLabel(slug) {
  const label = `from:prd-${slug}`;
  const data = await linearRequest(
    `query IssuesByPrd($label: String!) {
      issues(first: 250, filter: { labels: { name: { eq: $label } } }) {
        nodes {
          identifier
          title
          branchName
          url
          state { name type }
          projectMilestone { id name sortOrder }
          inverseRelations(first: 50) {
            nodes {
              type
              issue {
                identifier
                title
                state { name type }
              }
            }
          }
        }
      }
    }`,
    { label },
  );
  return data.issues.nodes;
}

function groupIssuesIntoWaves(issueNodes) {
  const milestoneGroups = new Map();
  const unmilestoned = [];

  for (const issueNode of issueNodes) {
    const issue = normalizeIssue(issueNode);
    const milestone = issueNode.projectMilestone;
    if (!milestone) {
      unmilestoned.push(issue);
      continue;
    }
    const group = milestoneGroups.get(milestone.id) ?? {
      name: milestone.name,
      sortOrder: milestone.sortOrder,
      issues: [],
    };
    group.issues.push(issue);
    milestoneGroups.set(milestone.id, group);
  }

  const milestoneWaves = Array.from(milestoneGroups.values())
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map((milestone, index) => ({
      number: index + 1,
      name: cleanMilestoneName(milestone.name),
      slug: slugify(cleanMilestoneName(milestone.name)),
      issues: milestone.issues.sort(compareIdentifiers),
    }))
    .filter((wave) => wave.issues.length > 0);

  if (milestoneWaves.length === 0 && unmilestoned.length > 0) {
    return [{ number: 1, name: "Unmilestoned", slug: "unmilestoned", issues: unmilestoned.sort(compareIdentifiers) }];
  }
  if (unmilestoned.length > 0) {
    milestoneWaves.push({
      number: milestoneWaves.length + 1,
      name: "Unmilestoned",
      slug: "unmilestoned",
      issues: unmilestoned.sort(compareIdentifiers),
    });
  }
  return milestoneWaves;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanMilestoneName(value) {
  return value.replace(/^Wave\s+\d+\s*[-:]\s*/i, "").trim();
}

function renderWaves(slug, prd, project, waves, generatedAt) {
  const issueCount = waves.reduce((total, wave) => total + wave.issues.length, 0);
  const lines = [
    `# WAVES - ${slug}`,
    "",
    "read_only_at_runtime: true",
    `generated_at: ${generatedAt}`,
    `source_prd: ${prd.path}`,
    `linear_project: ${project.url}`,
    `integration_branch: integration/${slug}`,
    `wave_count: ${waves.length}`,
    `issue_count: ${issueCount}`,
    "",
  ];

  for (const wave of waves) {
    lines.push(`## Wave ${wave.number} - ${wave.name} (slug: ${wave.slug})`, "");
    for (const issue of wave.issues) {
      const blockers = issue.blockedBy.length > 0 ? issue.blockedBy.map((blocker) => blocker.identifier).join(", ") : "-";
      const branch = issue.branchName || `feat/${issue.identifier.toLowerCase()}-${slugify(issue.title).slice(0, 48)}`;
      lines.push(`- [ ] ${issue.identifier} ${issue.title} | branch: ${branch} | state: ${issue.state} | blocked-by: ${blockers}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderTemplate(templateName, tokens) {
  const templatePath = path.join(SKILL_DIR, "references", templateName);
  let rendered = readFileSync(templatePath, "utf8").replace(/^<!--[\s\S]*?-->\n\n?/, "");
  for (const [key, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function prepareGoalDir(goalDir, force) {
  if (!existsSync(goalDir)) {
    mkdirSync(goalDir, { recursive: true });
    return;
  }
  const existingFiles = readdirSync(goalDir).filter((name) => !name.startsWith("."));
  if (existingFiles.length > 0 && !force) {
    fail(`${goalDir} already exists; re-run with --force to replace the generated package`);
  }
  for (const name of existingFiles) {
    rmSync(path.join(goalDir, name), { recursive: true, force: true });
  }
}

function writeFile(goalDir, name, contents) {
  writeFileSync(path.join(goalDir, name), contents, "utf8");
}

function renderControl(slug) {
  return `# CONTROL - ${slug}

paused: false
primary_priority: stability
max_runtime_per_step: 120m
require_approval_for:
  - scope_expansion
  - destructive_change
  - dependency_change

latest_nudge: ""

Notes:
- Edit this file to steer the running /goal without rewriting GOAL.md.
- The conductor rereads this file before each wave change, gate retry, and review handoff.
- This file can narrow scope or pause work; it cannot weaken done_when, /v1-check, or HIGH review blocking.
`;
}

function renderPlan(slug, waves) {
  const firstWave = waves[0] ? `Wave ${waves[0].number} - ${waves[0].name}` : "No waves";
  return `# PLAN - ${slug}

current_state: package generated
current_wave: ${firstWave}
current_issue: none
next_step: launch /goal with GOAL.md, then create integration/${slug} if needed

## Position

- [ ] Setup integration/${slug}
- [ ] Start ${firstWave}
- [ ] Stop for /risoluto-review-handoff ${slug} after the last wave merges
- [ ] Ingest REVIEW.md, clear HIGH findings, re-run /v1-check, print gh pr create
`;
}

function renderAttempts(slug) {
  return `# ATTEMPTS - ${slug}

Record failed approaches before retrying them.

| Time | Wave | Issue | Attempt | Evidence | Next adjustment |
| ---- | ---- | ----- | ------- | -------- | --------------- |
`;
}

function renderNotes(slug, waves, generatedAt) {
  const issueCount = waves.reduce((total, wave) => total + wave.issues.length, 0);
  return `# NOTES - ${slug}

- ${generatedAt}: Generated the /goal package from Linear milestones (${waves.length} waves, ${issueCount} issues).
- WAVES.md is frozen for deterministic execution. Re-run /risoluto-goal ${slug} to refresh after milestone changes.
- Issue status lives in Linear, code state lives in git, and process state lives in this goal folder.
`;
}

function writePackage(slug, prd, project, waves, force) {
  const generatedAt = new Date().toISOString();
  const goalDir = path.join(GOAL_ROOT, slug);
  const issueCount = waves.reduce((total, wave) => total + wave.issues.length, 0);
  const tokens = {
    SLUG: slug,
    INTEGRATION_BRANCH: `integration/${slug}`,
    PRD_PATH: prd.path,
    LINEAR_PROJECT_URL: project.url,
    REPO_ROOT,
    GOAL_DIR: `${goalDir}/`,
    BUDGET_MINUTES: "120",
    BUDGET_USD: "10",
    WAVE_COUNT: String(waves.length),
    ISSUE_COUNT: String(issueCount),
    GENERATED_AT: generatedAt,
  };

  prepareGoalDir(goalDir, force);
  writeFile(goalDir, "WAVES.md", renderWaves(slug, prd, project, waves, generatedAt));
  writeFile(goalDir, "SPEC.md", renderTemplate("SPEC.template.md", tokens));
  writeFile(goalDir, "GOAL.md", renderTemplate("GOAL.template.md", tokens));
  writeFile(goalDir, "CONTROL.md", renderControl(slug));
  writeFile(goalDir, "PLAN.md", renderPlan(slug, waves));
  writeFile(goalDir, "ATTEMPTS.md", renderAttempts(slug));
  writeFile(goalDir, "NOTES.md", renderNotes(slug, waves, generatedAt));
  return { goalDir, issueCount, generatedAt };
}

async function main() {
  const { slug, force } = parseArgs(process.argv.slice(2));
  assertSlug(slug);
  checkRepo();

  const prd = readPrd(slug);
  const project = await resolveProject(prd.linearProjectUrl);
  const issueNodes = await fetchIssuesByLabel(slug);
  const waves = groupIssuesIntoWaves(issueNodes);
  if (waves.length === 0) fail(`no Linear issues found for label from:prd-${slug}`);

  const written = writePackage(slug, prd, project, waves, force);
  console.error(
    [
      `risoluto-goal: rendered ${slug}`,
      `  goal_dir : ${written.goalDir}`,
      `  waves    : ${waves.length}`,
      `  issues   : ${written.issueCount}`,
      `  project  : ${project.url}`,
      "  launch   : codex -> /goal -> paste GOAL.md",
    ].join("\n"),
  );
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
