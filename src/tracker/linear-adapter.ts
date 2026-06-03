import type { Issue, RisolutoLogger } from "../core/types.js";
import { LinearClientError, type LinearClient } from "../linear/client.js";
import { withWorkflowRunId } from "../linear/issue-parser.js";
import type {
  TrackerIssueCreateInput,
  TrackerIssueCreateResult,
  TrackerPort,
  TrackerProvisionCreateLabelInput,
  TrackerProvisionCreateLabelResult,
  TrackerProvisionCreateProjectInput,
  TrackerProvisionCreateProjectResult,
  TrackerProvisionCreateTestIssueInput,
  TrackerProvisionCreateTestIssueResult,
  TrackerProvisionInput,
  TrackerProvisionListProjectsInput,
  TrackerProvisionListProjectsResult,
  TrackerProvisionSelectProjectInput,
  TrackerProvisionSelectProjectResult,
} from "./port.js";
import { toErrorString } from "../utils/type-guards.js";

/**
 * Optionally enrich a fetched Issue with its Risoluto-owned Workflow Run id.
 * When provided, called once per issue with the Linear issue id; the returned
 * string (if non-null) is stamped onto the issue via withWorkflowRunId.
 * NEVER pass the tracker issue id as the result — only the wr_UUID from the
 * intake idempotency store satisfies CR-03.
 */
export type WorkflowRunIdLookup = (linearIssueId: string) => Promise<string | undefined>;

export class LinearTrackerAdapter implements TrackerPort {
  constructor(
    private readonly client: LinearClient,
    private readonly logger?: Pick<RisolutoLogger, "warn">,
    private readonly lookupWorkflowRunId?: WorkflowRunIdLookup,
  ) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    const issues = await this.client.fetchCandidateIssues();
    return this.enrichIssues(issues);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    const issues = await this.client.fetchIssueStatesByIds(ids);
    return this.enrichIssues(issues);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    const issues = await this.client.fetchIssuesByStates(states);
    return this.enrichIssues(issues);
  }

  resolveStateId(stateName: string): Promise<string | null> {
    return this.client.resolveStateId(stateName);
  }

  updateIssueState(issueId: string, stateId: string): Promise<void> {
    return this.client.updateIssueState(issueId, stateId);
  }

  createComment(issueId: string, body: string): Promise<void> {
    return this.client.createComment(issueId, body);
  }

  createIssue(input: TrackerIssueCreateInput): Promise<TrackerIssueCreateResult> {
    return this.client.createIssue({
      title: input.title,
      description: input.description ?? null,
      stateName: input.stateName ?? null,
    });
  }

  async transitionIssue(issueId: string, stateId: string): Promise<{ success: boolean }> {
    try {
      await this.client.updateIssueStateStrict(issueId, stateId);
      return { success: true };
    } catch (error) {
      this.logger?.warn({ issueId, stateId, error: toErrorString(error) }, "linear tracker transition failed");
      return { success: false };
    }
  }

  provision(input: TrackerProvisionListProjectsInput): Promise<TrackerProvisionListProjectsResult>;
  provision(input: TrackerProvisionSelectProjectInput): Promise<TrackerProvisionSelectProjectResult>;
  provision(input: TrackerProvisionCreateProjectInput): Promise<TrackerProvisionCreateProjectResult>;
  provision(input: TrackerProvisionCreateTestIssueInput): Promise<TrackerProvisionCreateTestIssueResult>;
  provision(input: TrackerProvisionCreateLabelInput): Promise<TrackerProvisionCreateLabelResult>;
  async provision(
    input: TrackerProvisionInput,
  ): Promise<
    | TrackerProvisionListProjectsResult
    | TrackerProvisionSelectProjectResult
    | TrackerProvisionCreateProjectResult
    | TrackerProvisionCreateTestIssueResult
    | TrackerProvisionCreateLabelResult
  > {
    switch (input.type) {
      case "list_projects":
        return this.withProvisionErrorSurface(() => this.listProjects());
      case "select_project":
        return { ok: true };
      case "create_project":
        return this.withProvisionErrorSurface(async () => ({
          ok: true,
          project: await this.client.createProject(input.name),
        }));
      case "create_test_issue":
        return this.withProvisionErrorSurface(async () => ({
          ok: true,
          ...(await this.client.createSetupTestIssue()),
        }));
      case "create_label":
        return this.withProvisionErrorSurface(async () => ({
          ok: true,
          ...(await this.client.ensureRisolutoLabel()),
        }));
    }
  }

  private async enrichIssues(issues: Issue[]): Promise<Issue[]> {
    if (!this.lookupWorkflowRunId) {
      return issues;
    }
    return Promise.all(
      issues.map(async (issue) => {
        const wrId = await this.lookupWorkflowRunId!(issue.id).catch(() => undefined);
        return withWorkflowRunId(issue, wrId);
      }),
    );
  }

  private async listProjects(): Promise<TrackerProvisionListProjectsResult> {
    return {
      projects: await this.client.listProjects(),
    };
  }

  private async withProvisionErrorSurface<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LinearClientError && error.code === "linear_transport_error" && error.cause) {
        throw new Error(toErrorString(error.cause), { cause: error });
      }
      throw error;
    }
  }
}
