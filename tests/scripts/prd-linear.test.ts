import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProjectPrdMirror, normalizeForComparison } from "../../scripts/prd-linear.js";

describe("PRD Linear helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the full PRD mirror from Linear project content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            projects: {
              nodes: [
                {
                  id: "project-id",
                  name: "workflow-first-afk-mvp",
                  slugId: "838087658d56",
                  description: "Short project overview",
                  content: "## Problem Statement\n\nFull PRD body",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const project = await fetchProjectPrdMirror("lin_api_test", "838087658d56");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body)) as { query: string; variables: { slugId: string } };

    expect(project.description).toBe("Short project overview");
    expect(project.content).toBe("## Problem Statement\n\nFull PRD body");
    expect(body.query).toContain("content");
    expect(body.variables.slugId).toBe("838087658d56");
  });

  it("normalizes Linear markdown list serialization without hiding text drift", () => {
    const local = [
      "1. As an operator, I want the first line to wrap,",
      "   so that Prettier can format it.",
      "2. As an operator, I want another item.",
      "",
      "- A bullet",
      "",
      "```",
      "* keep fenced content exact",
      "```",
    ].join("\n");
    const linear = [
      " 1. As an operator, I want the first line to wrap,",
      "    so that Prettier can format it.",
      " 2. As an operator, I want another item.",
      "",
      "* A bullet",
      "",
      "```",
      "* keep fenced content exact",
      "```",
    ].join("\n");

    expect(normalizeForComparison(linear)).toBe(normalizeForComparison(local));
    expect(normalizeForComparison(linear.replace("another item", "changed item"))).not.toBe(
      normalizeForComparison(local),
    );
  });
});
