# review-handoff.v1 - contract

A Codex-actionable end-review artifact. Sibling in spirit to the PRD's `handoff.v1`: structured JSON plus
rendered Markdown, finding-by-finding, source-linked. The Codex `/goal` loop walks `findings[]` and fixes
each using its `problem` + `fix`; it treats every `HIGH` as merge-blocking.

## Fields

| Field         | Type           | Meaning                                                                                                                                          |
| ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract`    | string         | always `"review-handoff.v1"`                                                                                                                     |
| `slug`        | string         | the PRD slug reviewed                                                                                                                            |
| `branch`      | string         | the branch reviewed (`integration/<slug>`)                                                                                                       |
| `base`        | string         | what it was diffed against (`origin/master`)                                                                                                     |
| `reviewed_by` | string         | the reviewing model/agent (e.g. `claude-opus-4.8`)                                                                                               |
| `summary`     | object         | `{ high: int, med: int, nit: int }`                                                                                                              |
| `ac_summary`  | object \| null | rollup of the per-ticket `ac-verify.v1` files: `{ total, met, not_met, unverifiable, blocking_tickets: string[] }`; `null` if no checks were run |
| `findings`    | array          | the prioritized findings (below)                                                                                                                 |

### `findings[]`

| Field      | Type        | Meaning                                                      |
| ---------- | ----------- | ------------------------------------------------------------ |
| `id`       | string      | stable id, e.g. `H1`, `M2`, `N1`                             |
| `severity` | enum        | `HIGH` \| `MED` \| `NIT`                                     |
| `file`     | string      | repo-relative path                                           |
| `line`     | int \| null | line or anchor; null if cross-file                           |
| `problem`  | string      | what is wrong, concretely                                    |
| `fix`      | string      | the concrete change to make - actionable without re-deriving |
| `trace`    | string      | what it ties to: PRD story #, issue id, or ADR section       |
| `status`   | enum        | `open` \| `resolved` (the conductor flips it)                |

Severity is a contract: **HIGH** = correctness bug / unmet acceptance criterion / invariant violation
(blocks the PR); **MED** = should fix; **NIT** = optional polish.

## JSON shape

```json
{
  "contract": "review-handoff.v1",
  "slug": "workflow-first-afk-mvp",
  "branch": "integration/workflow-first-afk-mvp",
  "base": "origin/master",
  "reviewed_by": "claude-opus-4-8",
  "summary": { "high": 2, "med": 1, "nit": 1 },
  "ac_summary": { "total": 8, "met": 7, "not_met": 1, "unverifiable": 0, "blocking_tickets": ["NIN-220"] },
  "findings": [
    {
      "id": "H1",
      "severity": "HIGH",
      "file": "src/workflow/registry.ts",
      "line": 142,
      "problem": "An unknown role id is not rejected at load; the run starts and fails mid-execution.",
      "fix": "Validate every referenced role/gate/hook/action id against the registry in loadDefinition() and throw before the run is created.",
      "trace": "PRD story 14; NIN-195",
      "status": "open"
    },
    {
      "id": "H2",
      "severity": "HIGH",
      "file": "src/intake/idempotency.ts",
      "line": 88,
      "problem": "Webhook and polling can both create a run for one external object (race).",
      "fix": "Claim the logical mapping transactionally before any side effect; key on provider + external object id only.",
      "trace": "PRD Implementation Decisions (idempotency); NIN-202",
      "status": "open"
    },
    {
      "id": "N1",
      "severity": "NIT",
      "file": "src/cli/run.ts",
      "line": 33,
      "problem": "Thrown error omits the run id, making AFK logs hard to trace.",
      "fix": "Include the run id in the thrown error context.",
      "trace": "PRD Error-handling conventions",
      "status": "open"
    }
  ]
}
```

## Rendered Markdown (`REVIEW.md`)

````md
# review-handoff.v1 - workflow-first-afk-mvp

branch: integration/workflow-first-afk-mvp
base: origin/master
reviewed_by: claude-opus-4.8
summary: 2 HIGH, 1 MED, 1 NIT (HIGH blocks the PR)

```json
{ "...": "embed the full review-handoff.v1 JSON here" }
```

## HIGH

- [H1] src/workflow/registry.ts:142 - unknown role id not rejected at load
  fix: validate referenced ids against the registry in loadDefinition(); throw before run create
  trace: PRD story 14; NIN-195
- [H2] src/intake/idempotency.ts:88 - webhook + polling race creates 2 runs for one object
  fix: claim the mapping transactionally before side effects; key on provider + external object id
  trace: PRD idempotency; NIN-202

## NIT

- [N1] src/cli/run.ts:33 - error omits run id
  fix: include the run id in the thrown error context
  trace: PRD error-handling
````

`REVIEW.md` carries both: the human-readable list and the JSON block (in a fenced ```json) so the conductor
parses one file. The conductor flips each `status`to`resolved`as it fixes, and the run does not advance to
the PR while any HIGH is`open`.

For a clean review, still write the artifact with `summary: { "high": 0, "med": 0, "nit": 0 }` and
`findings: []`; absence of `REVIEW.md` is not a pass.
