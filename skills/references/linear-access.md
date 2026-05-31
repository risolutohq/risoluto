# Linear access (agent-portable)

Shared reference for every Risoluto skill that touches Linear (`risoluto-to-prd`, `risoluto-to-issues`, `risoluto-next-bundle`, `risoluto-tdd`). The skills describe Linear **operations** by intent; this file is the concrete binding so the work runs identically under Claude and Codex.

## Two bindings, one behaviour

| Agent                                        | Binding                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude**                                   | The Linear MCP tools (`mcp__linear-server__<op>` — `list_issues`, `get_issue`, `save_issue`, `save_comment`, `create_issue_label`, `save_milestone`, plus the native attachment/link operation when exposed, `list_teams`, …). Convenient when configured. |
| **Codex / any agent without the Linear MCP** | `LINEAR_API_KEY` + the Linear GraphQL API (below). `.codex/config.toml` ships no Linear MCP, so this is the Codex path.                                                                                                                                    |

The GraphQL path is the **portable baseline** — it works under both agents and needs no MCP server. If neither surface is reachable, surface the error verbatim and stop; never retry auth.

## Endpoint & auth

```bash
linear() {
  # Usage: linear '<graphql>' '<json-variables-object>'   (variables default to {})
  local query="$1" vars="${2:-}"
  [ -n "$vars" ] || vars='{}'
  curl -sS https://api.linear.app/graphql \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$(jq -nc --arg q "$query" --argjson v "$vars" '{query:$q, variables:$v}')"
}
```

A **personal API key** (`lin_api_…`) goes in the `Authorization` header **raw — no `Bearer` prefix** (only OAuth access tokens use `Bearer`). Send markdown bodies as real newlines, not `\n`.

## Operations

### Connectivity probe (precondition check)

```graphql
query {
  viewer {
    id
    name
  }
}
```

Non-empty `viewer` = reachable. Surface any error verbatim; do not retry auth.

### Resolve the team id (default team `Ninetech`)

```graphql
query FindTeam($key: String!) {
  teams(filter: { key: { eq: $key } }) {
    nodes {
      id
      key
      name
    }
  }
}
```

Only one team exists in this workspace — do not ask. Cache the returned `id` for `teamId` fields below.

### Resolve a workflow-state id (needed to claim a ticket as "In Progress")

States are team-scoped; you need the **UUID**, not the name.

```graphql
query States($teamId: ID!) {
  workflowStates(filter: { team: { id: { eq: $teamId } } }) {
    nodes {
      id
      name
      type
    }
  }
}
```

Pick the node whose `name` is `In Progress` (or `type: started`).

### Get an issue by ticket ref

Linear's `issue(id:)` resolver accepts both the UUID **and** the team-prefixed identifier (e.g. `RSL-123`).

```graphql
query GetIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state {
      id
      name
      type
    }
    labels {
      nodes {
        name
      }
    }
    project {
      id
    }
    relations {
      nodes {
        type
        relatedIssue {
          id
          identifier
          state {
            name
          }
        }
      }
    }
    inverseRelations {
      nodes {
        type
        issue {
          id
          identifier
          state {
            name
          }
        }
      }
    }
  }
}
```

`blocked-by` edges appear as `inverseRelations` with `type: "blocks"` (the other issue blocks this one). Check each blocker's `state.name` is `Done` before proceeding.

### List issues by label (ready-set / reconcile scans)

```graphql
query ByLabel($label: String!) {
  issues(filter: { labels: { name: { eq: $label } } }) {
    nodes {
      id
      identifier
      title
      state {
        name
        type
      }
      labels {
        nodes {
          name
        }
      }
    }
  }
}
```

### List / create a label (label preflight)

```graphql
query Labels($name: String!) {
  issueLabels(filter: { name: { eq: $name } }) {
    nodes {
      id
      name
    }
  }
}
```

```graphql
mutation CreateLabel($teamId: String!, $name: String!, $color: String!, $description: String!) {
  issueLabelCreate(input: { teamId: $teamId, name: $name, color: $color, description: $description }) {
    success
    issueLabel {
      id
      name
    }
  }
}
```

Labels are team-level — create once, reuse across PRDs.

### Create a project milestone (build waves)

```graphql
mutation CreateMilestone($projectId: String!, $name: String!, $description: String!) {
  projectMilestoneCreate(input: { projectId: $projectId, name: $name, description: $description }) {
    success
    projectMilestone {
      id
      name
    }
  }
}
```

### Create an issue

```graphql
mutation CreateIssue(
  $teamId: String!
  $title: String!
  $description: String!
  $projectId: String
  $labelIds: [String!]
  $stateId: String
  $projectMilestoneId: String
) {
  issueCreate(
    input: {
      teamId: $teamId
      title: $title
      description: $description
      projectId: $projectId
      labelIds: $labelIds
      stateId: $stateId
      projectMilestoneId: $projectMilestoneId
    }
  ) {
    success
    issue {
      id
      identifier
      url
    }
  }
}
```

Pass `labelIds` (resolved UUIDs), not label names. Capture `identifier` + `url` for downstream relations and summaries.

### Attach a URL to an issue (native sidebar link)

```graphql
mutation CreateAttachment($issueId: String!, $title: String!, $url: String!, $subtitle: String) {
  attachmentCreate(input: { issueId: $issueId, title: $title, url: $url, subtitle: $subtitle }) {
    success
    attachment {
      id
      url
      title
    }
  }
}
```

Use this after `issueCreate` returns the issue id. Attachment URLs are idempotent per issue, so re-running with the same PRD blob URL updates the existing attachment instead of duplicating it.

### Wire relations (`blocked-by` / `related`)

```graphql
mutation Relate($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
  issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type }) {
    success
  }
}
```

`type` is `blocks` (for hard ordering — set it on the **blocker**, pointing at the blocked issue) or `related` (soft coupling). Never remove a `blocks` edge and add a `related` edge for the same pair in one call — Linear rejects the mixed transaction; do it in two calls.

### Claim a ticket (set "In Progress") / update status

```graphql
mutation Claim($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue {
      id
      state {
        name
      }
    }
  }
}
```

### Back-comment an issue (PR link, discovery provenance)

```graphql
mutation Comment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) {
    success
    comment {
      id
      url
    }
  }
}
```

## Notes

- **Connections paginate — don't silently truncate.** Linear returns at most 50 nodes per connection unless you ask for more (`first:` up to 250). For any scan that could exceed that (`issues(filter: { labels … })` on a large PRD), pass `first: 250` and follow `pageInfo { hasNextPage endCursor }` with `after: $endCursor` until exhausted. A bare `issues(filter:)` that quietly stops at 50 will drop ready-set members.
- **Project create/update mutations** (`projectCreate` / `projectUpdate`, for PRD bodies) live in `risoluto-to-prd` Step 3 — the original reference implementation for the GraphQL path.
- **Attachments can rate-limit.** If `attachmentCreate` returns a rate-limit error, the issue's other fields still saved — retry just that attachment after a short gap.
- Field names track the live Linear schema; if a mutation shape drifts, the authoritative source is the schema explorer at <https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference>.
