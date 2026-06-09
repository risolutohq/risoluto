/**
 * LinearTrackerToolProvider — exposes the `linear_graphql` dynamic tool
 * to Codex sessions when the tracker kind is "linear".
 */

import { LinearClient } from "./client.js";
import { handleLinearGraphqlToolCall } from "./graphql-tool.js";
import type { TrackerToolCall, TrackerToolProvider } from "../tracker/tool-provider.js";

export class LinearTrackerToolProvider implements TrackerToolProvider {
  readonly toolNames: ReadonlyArray<string> = ["linear_graphql"];

  constructor(private readonly client: LinearClient) {}

  async handleToolCall(toolName: string, toolArgs: unknown): Promise<TrackerToolCall | null> {
    if (toolName !== "linear_graphql") {
      return null;
    }
    const response = await handleLinearGraphqlToolCall(this.client, toolArgs);
    // All Linear tool-call errors are intentionally non-fatal: the agent receives
    // the error as a tool result and decides how to proceed. Auth failures (401),
    // transport errors, and GraphQL errors are all converted to non-fatal
    // toolCallFailure payloads inside handleLinearGraphqlToolCall's catch block.
    return { response, fatalFailure: null };
  }
}
