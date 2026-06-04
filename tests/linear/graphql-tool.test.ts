import { describe, expect, it, vi } from "vitest";

import { handleLinearGraphqlToolCall } from "../../src/linear/graphql-tool.js";
import { LinearClient } from "../../src/linear/client.js";

describe("handleLinearGraphqlToolCall", () => {
  it("returns the required wire shape for a valid single operation", async () => {
    const client = {
      runGraphQL: vi.fn(async () => ({ data: { viewer: { id: "123" } } })),
    } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(client, {
      query: "query One { viewer { id } }",
    });

    expect(response.success).toBe(true);
    expect(response.contentItems).toHaveLength(1);
    expect(response.contentItems[0]).toEqual({
      type: "inputText",
      text: JSON.stringify({ data: { viewer: { id: "123" } } }),
    });
  });

  it("rejects documents with more than one operation", async () => {
    const client = {
      runGraphQL: vi.fn(),
    } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(
      client,
      "query One { viewer { id } } query Two { teams { nodes { id } } }",
    );

    expect(response.success).toBe(false);
    expect(JSON.parse(response.contentItems[0].text)).toEqual({
      error: "linear_graphql requires exactly one operation",
    });
  });

  it("rejects mutation operations and never calls the client (NIN-248)", async () => {
    const runGraphQL = vi.fn();
    const client = { runGraphQL } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(client, {
      query: 'mutation Kill { issueDelete(id: "x") { success } }',
    });

    expect(response.success).toBe(false);
    expect(JSON.parse(response.contentItems[0].text)).toEqual({
      error: "linear_graphql only permits read-only query operations (mutation/subscription rejected)",
    });
    expect(runGraphQL).not.toHaveBeenCalled();
  });

  it("rejects subscription operations and never calls the client (NIN-248)", async () => {
    const runGraphQL = vi.fn();
    const client = { runGraphQL } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(client, {
      query: "subscription Watch { issues { id } }",
    });

    expect(response.success).toBe(false);
    expect(JSON.parse(response.contentItems[0].text)).toEqual({
      error: "linear_graphql only permits read-only query operations (mutation/subscription rejected)",
    });
    expect(runGraphQL).not.toHaveBeenCalled();
  });

  it("rejects queries that select secret-bearing fields (NIN-248)", async () => {
    const runGraphQL = vi.fn();
    const client = { runGraphQL } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(client, {
      query: "query Leak { webhooks { nodes { secret } } }",
    });

    expect(response.success).toBe(false);
    expect(JSON.parse(response.contentItems[0].text)).toEqual({
      error: "linear_graphql rejects secret-bearing fields (e.g. webhook secret, tokens)",
    });
    expect(runGraphQL).not.toHaveBeenCalled();
  });

  it("rejects camelCase/compound secret fields the word-boundary regex missed (NIN-248)", async () => {
    const runGraphQL = vi.fn();
    const client = { runGraphQL } as unknown as LinearClient;

    for (const field of ["authToken", "apiKeys", "personalApiToken", "clientSecret", "credential"]) {
      const response = await handleLinearGraphqlToolCall(client, { query: `query Leak { foo { ${field} } }` });
      expect(response.success).toBe(false);
      expect(JSON.parse(response.contentItems[0].text).error).toContain("secret-bearing");
    }
    expect(runGraphQL).not.toHaveBeenCalled();
  });

  it("still allows a non-secret field that merely contains 'key' such as Team.key (NIN-248)", async () => {
    const runGraphQL = vi.fn(async () => ({ data: { teams: { nodes: [{ key: "NIN" }] } } }));
    const client = { runGraphQL } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(client, {
      query: "query Teams { teams { nodes { key } } }",
    });

    expect(response.success).toBe(true);
    expect(runGraphQL).toHaveBeenCalledOnce();
  });

  it("returns success=false when the GraphQL payload contains top-level errors", async () => {
    const client = {
      runGraphQL: vi.fn(async () => ({ data: null, errors: [{ message: "boom" }] })),
    } as unknown as LinearClient;

    const response = await handleLinearGraphqlToolCall(client, {
      query: "query One { viewer { id } }",
    });

    expect(response.success).toBe(false);
    expect(JSON.parse(response.contentItems[0].text)).toEqual({
      data: null,
      errors: [{ message: "boom" }],
    });
  });
});
