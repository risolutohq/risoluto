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

### Create / update a project (PRD body)

The owner of project-level mutations for the PRD pipeline (`risoluto-to-prd`). A PRD's body is the
project's `content` field — **not** the short `description`, and not reachable via the
`mcp__linear-server__save_project` MCP surface (which cannot set `content`). Use GraphQL.

**CREATE** (first promotion of a roadmap row). First resolve the project **lead** — a minted PRD
project is _born owned_, never an orphaned unassigned Backlog container:

```graphql
query Me {
  viewer {
    id
    name
  }
}
```

Then `projectCreate`:

```graphql
mutation CreateProject(
  $name: String!
  $teamIds: [String!]!
  $description: String!
  $content: String!
  $leadId: String!
  $priority: Int!
) {
  projectCreate(
    input: { name: $name, teamIds: $teamIds, description: $description, content: $content, leadId: $leadId, priority: $priority }
  ) {
    success
    project {
      id
      name
      url
      description
      content
      lead {
        id
        name
      }
      priority
    }
  }
}
```

- `name`: the `<slug>` (or a humanised variant; the slug is the stable join key).
- `teamIds`: `[<Ninetech team id>]` (the only team — do not ask).
- `description`: a clean one-sentence summary, max 255 chars.
- `content`: the PRD body (literal markdown, real newlines — no escape sequences).
- `leadId`: the `viewer.id` above — born owned, not an orphaned planning container.
- `priority`: `2` (High) — a promoted PRD is real, active work; stamp it at birth.

Capture the returned `url` (e.g. `https://linear.app/ninetech/project/<slug>-<random>/overview`) — it
becomes the PRD frontmatter `linear_project` value and the roadmap Status-cell link.

**SYNC** (re-run; git PRD is canon, overwrite the mirror). Resolve the existing project by the
`slugId` segment of the `linear_project` URL (see [ProjectBySlug](#list-project-milestones--issues-wave-derivation)),
then `projectUpdate`:

```graphql
mutation UpdateProject($id: String!, $description: String!, $content: String!) {
  projectUpdate(id: $id, input: { description: $description, content: $content }) {
    success
    project {
      id
      name
      url
      description
      content
    }
  }
}
```

SYNC deliberately does **not** re-assert `leadId` or `priority`: once the project exists, ownership and
priority are operator-owned and a re-sync must not clobber a reassignment.

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

Linear's `issue(id:)` resolver accepts both the UUID **and** the team-prefixed identifier (e.g. `RIS-123`).

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

### List project milestones + issues (wave derivation)

Waves are project milestones. Pull them sorted, each with its issues and `blocked-by` edges — this is the
query `risoluto-goal-prep` freezes into `WAVES.md`:

Resolve the project UUID from the PRD `linear_project` URL first. The URL segment after `/project/` is
Linear's `slugId`:

```graphql
query ProjectBySlug($slugId: String!) {
  projects(first: 1, filter: { slugId: { eq: $slugId } }) {
    nodes {
      id
      name
      url
      slugId
    }
  }
}
```

Use the `from:prd-<slug>` label query and group issues by `projectMilestone` locally. This is cheaper than a
deep project -> milestones -> issues -> relations query, which can exceed Linear's complexity limit.

```graphql
query IssuesByPrd($label: String!) {
  issues(first: 250, filter: { labels: { name: { eq: $label } } }) {
    nodes {
      identifier
      title
      branchName
      url
      state {
        name
        type
      }
      projectMilestone {
        id
        name
        sortOrder
      }
      inverseRelations(first: 50) {
        nodes {
          type
          issue {
            identifier
            title
            state {
              name
              type
            }
          }
        }
      }
    }
  }
}
```

Group by `projectMilestone.id`, then sort groups by `projectMilestone.sortOrder` ascending. Within a
milestone, an `inverseRelations` node of `type: "blocks"` is one of the issue's `blocked-by` edges (the
ready-set filter). A project with **no** milestones → one wave, all `from:prd-<slug>` issues ordered by
`blocked-by`. Under Claude, `mcp__linear-server__list_milestones` + `list_issues` cover the same data without
GraphQL, but keep the same grouping semantics.

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
  $parentId: String
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
      parentId: $parentId
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

Pass `labelIds` (resolved UUIDs), not label names. Capture `identifier` + `url` for downstream relations and summaries. Pass `parentId` (the parent issue's UUID) to create a **sub-issue** — e.g. `risoluto-architecture-loop`'s candidate sub-issues are children of its run issue. It is optional, so existing callers that omit it are unaffected.

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

Under Claude (MCP), the same native sidebar link is achievable without the raw mutation by passing `links: [{ url, title }]` to `save_issue` (append-only; existing links are never removed) — prefer that over the GraphQL fallback when running on the Claude fast-path.

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

**Idempotent back-comments — the marker convention.** Any skill (or the afk-orchestrator daemon)
that back-comments an issue more than once over its lifetime must make the write idempotent so a
re-run never stacks duplicate comments. Embed a hidden HTML-comment marker on the first line of the
body:

```
<!-- risoluto:<kind>[:<key>] -->
```

`<kind>` names the writer's intent (`pr-link`, `sync`, `discovery`, `review`, …); the optional
`<key>` scopes it (a slug, a ticket ref, a wave id). Before commenting, **list the issue's existing
comments and skip the write if a comment already carries the same marker** (update it in place only
if the body changed). This is the one convention shared across every Linear writer — keep the marker
string identical so the dedup matches.

## Notes

- **Connections paginate — don't silently truncate.** Linear returns at most 50 nodes per connection unless you ask for more (`first:` up to 250). For any scan that could exceed that (`issues(filter: { labels … })` on a large PRD), pass `first: 250` and follow `pageInfo { hasNextPage endCursor }` with `after: $endCursor` until exhausted. A bare `issues(filter:)` that quietly stops at 50 will drop ready-set members.
- **Project create/update mutations** (`projectCreate` / `projectUpdate`, for PRD bodies) live in [Create / update a project (PRD body)](#create--update-a-project-prd-body) above — this file owns _all_ Linear GraphQL, issue- and project-level. `risoluto-to-prd` binds to that operation; it carries no inline mutation of its own.
- **Attachments can rate-limit.** If `attachmentCreate` returns a rate-limit error, the issue's other fields still saved — retry just that attachment after a short gap.
- Field names track the live Linear schema; if a mutation shape drifts, the authoritative source is the schema explorer at <https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference>.
