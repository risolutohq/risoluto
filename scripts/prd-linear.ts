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
  sourceIdea: string;
  status: string;
}

export interface ProjectDescription {
  id: string;
  name: string;
  slugId: string;
  description: string | null;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

const PROJECT_DESCRIPTION_QUERY = `
  query PrdDriftCheck($slugId: String!) {
    projects(first: 1, filter: { slugId: { eq: $slugId } }) {
      nodes {
        id
        name
        slugId
        description
      }
    }
  }
`;

/** Fetch a Linear project's description by slugId. */
export async function fetchProjectDescription(apiKey: string, slugId: string): Promise<ProjectDescription> {
  const response = await fetch(LINEAR_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({ query: PROJECT_DESCRIPTION_QUERY, variables: { slugId } }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Linear API returned ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as GraphQLResponse;

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${payload.errors.map((error) => error.message).join(", ")}`);
  }

  const nodes = (payload.data?.projects as { nodes: ProjectDescription[] } | undefined)?.nodes;
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
      sourceIdea: raw.source_idea,
      status: raw.status,
    },
    body: match[2],
  };
}

/** Normalize text for comparison: trim trailing whitespace per line, normalize line endings. */
export function normalizeForComparison(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Get the LINEAR_API_KEY or exit gracefully if not set. */
export function requireApiKey(): string | null {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    process.stderr.write("⚠️  LINEAR_API_KEY not set — skipping PRD drift check.\n");
    return null;
  }
  return apiKey;
}
