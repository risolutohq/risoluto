/**
 * Shared Linear API helpers for PRD drift check and reconcile scripts.
 *
 * Talks to Linear GraphQL directly (no MCP — these scripts run in shell
 * contexts where Claude Code MCP tools are unavailable).
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

const LINEAR_ENDPOINT = process.env.LINEAR_API_ENDPOINT ?? "https://api.linear.app/graphql";

export interface PrdFrontmatter {
  slug: string;
  linearProject: string;
  slugId: string;
  syncedAt: string;
  source: string;
  status: string;
}

export interface ProjectPrdMirror {
  id: string;
  name: string;
  slugId: string;
  description: string | null;
  content: string | null;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

const PROJECT_PRD_MIRROR_QUERY = `
  query PrdDriftCheck($slugId: String!) {
    projects(first: 1, filter: { slugId: { eq: $slugId } }) {
      nodes {
        id
        name
        slugId
        description
        content
      }
    }
  }
`;

/** Fetch the Linear fields that mirror a git-canonical PRD. */
export async function fetchProjectPrdMirror(apiKey: string, slugId: string): Promise<ProjectPrdMirror> {
  const response = await fetch(LINEAR_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({ query: PROJECT_PRD_MIRROR_QUERY, variables: { slugId } }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Linear API returned ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as GraphQLResponse;

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${payload.errors.map((error) => error.message).join(", ")}`);
  }

  const nodes = (payload.data?.projects as { nodes: ProjectPrdMirror[] } | undefined)?.nodes;
  const project = nodes?.at(0);
  if (!project) {
    throw new Error(`No Linear project found with slugId "${slugId}"`);
  }

  return project;
}

/** Extract the slugId from a Linear project URL. */
export function extractSlugId(projectUrl: string): string {
  const lastSegment = new URL(projectUrl).pathname.split("/").pop() ?? "";
  const lastHyphen = lastSegment.lastIndexOf("-");
  if (lastHyphen === -1) {
    throw new Error(`Cannot extract slugId from Linear project URL: ${projectUrl}`);
  }
  return lastSegment.slice(lastHyphen + 1);
}

/** Parse a PRD file's frontmatter and return structured data. */
export async function parsePrdFile(filePath: string): Promise<{ frontmatter: PrdFrontmatter; body: string }> {
  const content = await readFile(filePath, "utf8");
  return parsePrdContent(content);
}

/** Parse PRD content string into frontmatter + body. */
export function parsePrdContent(content: string): { frontmatter: PrdFrontmatter; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) {
    throw new Error("PRD file has no valid frontmatter");
  }

  const raw = parseYaml(match[1]) as Record<string, string>;
  const linearProject = raw.linear_project;
  if (!linearProject) {
    throw new Error("PRD frontmatter missing linear_project URL");
  }

  return {
    frontmatter: {
      slug: raw.slug,
      linearProject,
      slugId: extractSlugId(linearProject),
      syncedAt: raw.synced_at,
      source: raw.source,
      status: raw.status,
    },
    body: match[2],
  };
}

/**
 * Fold inline emphasis markers Linear canonicalizes on storage (e.g. `_x_` -> `*x*`, and it repositions
 * `**` around inline code). Drift is about content, not emphasis flavor, so strip emphasis delimiters:
 * all `*` (leading bullets are already `-` by this point) and word-bounded `_` (intra-word underscores
 * in identifiers like `change_summary` are preserved). Backticks are kept — Linear round-trips them.
 */
function foldInlineEmphasis(line: string): string {
  return line
    .replace(/\*/g, "")
    .replace(/(?<![A-Za-z0-9])_+(?=[A-Za-z0-9])/g, "")
    .replace(/(?<=[A-Za-z0-9])_+(?![A-Za-z0-9])/g, "");
}

function normalizeMarkdownLine(line: string, inOrderedList: boolean): { line: string; inOrderedList: boolean } {
  const bulletNormalized = foldInlineEmphasis(line.replace(/^(\s*)[*-](\s+)/, "$1-$2"));
  const orderedMatch = /^ {0,3}(\d+\.\s.*)$/.exec(bulletNormalized);
  if (orderedMatch) {
    return { line: orderedMatch[1], inOrderedList: true };
  }

  if (bulletNormalized.trim() === "" || /^#{1,6}\s/.test(bulletNormalized)) {
    return { line: bulletNormalized, inOrderedList: false };
  }

  if (inOrderedList && bulletNormalized.startsWith("    ")) {
    return { line: bulletNormalized.slice(1), inOrderedList: true };
  }

  return { line: bulletNormalized, inOrderedList };
}

/** Normalize text for comparison: trim trailing whitespace, line endings, and Linear markdown formatting. */
export function normalizeForComparison(text: string): string {
  let inFence = false;
  let inOrderedList = false;
  const normalizedLines: string[] = [];

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const trimmedLine = rawLine.trimEnd();
    if (/^\s*(```|~~~)/.test(trimmedLine)) {
      inFence = !inFence;
      normalizedLines.push(trimmedLine);
      continue;
    }

    if (inFence) {
      normalizedLines.push(trimmedLine);
      continue;
    }

    const normalized = normalizeMarkdownLine(trimmedLine, inOrderedList);
    normalizedLines.push(normalized.line);
    inOrderedList = normalized.inOrderedList;
  }

  return normalizedLines.join("\n").trim();
}

/** Split markdown body into a Map<heading, sectionBody>. Preamble before the first `## ` is keyed as `(preamble)`. */
export function sectionMap(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentHeading = "(preamble)";
  let currentBody: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      sections.set(currentHeading, currentBody.join("\n").trim());
      currentHeading = line.slice(3).trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  sections.set(currentHeading, currentBody.join("\n").trim());
  // Drop preamble if empty — most PRDs start with `## ` and have no preamble.
  if (sections.get("(preamble)") === "") sections.delete("(preamble)");
  return sections;
}

export interface SectionDiff {
  heading: string;
  kind: "only-in-local" | "only-in-linear" | "differs";
}

/** Section-by-section diff between two markdown bodies. Returns empty array if identical. */
export function diffSections(local: string, linear: string): SectionDiff[] {
  const localSecs = sectionMap(normalizeForComparison(local));
  const linearSecs = sectionMap(normalizeForComparison(linear));
  const allHeadings = new Set([...localSecs.keys(), ...linearSecs.keys()]);
  const diffs: SectionDiff[] = [];
  for (const heading of allHeadings) {
    const l = localSecs.get(heading);
    const r = linearSecs.get(heading);
    if (l == null && r != null) diffs.push({ heading, kind: "only-in-linear" });
    else if (l != null && r == null) diffs.push({ heading, kind: "only-in-local" });
    else if (l !== r) diffs.push({ heading, kind: "differs" });
  }
  return diffs;
}

/** Get the LINEAR_API_KEY or exit with an actionable error. Hard gate — no silent skip. */
export function requireApiKey(): string {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    process.stderr.write("❌ LINEAR_API_KEY is required for PRD drift check.\n");
    process.stderr.write("   Set it via:  export LINEAR_API_KEY=lin_api_...\n");
    process.stderr.write("   This is a hard gate — no SKIP_HOOKS bypass for missing key.\n");
    process.exit(1);
  }
  return apiKey;
}
