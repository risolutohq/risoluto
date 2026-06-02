---
name: risoluto-review-handoff
description: Produce the end-review artifact for a Risoluto AFK goal. Use for /risoluto-review-handoff <slug> after integration/<slug> has all waves merged. A different model reviews integration/<slug> against docs/prds/<slug>.md and the Linear issues, then writes review-handoff.v1 to ~/.risoluto/goals/<slug>/REVIEW.md and a Linear comment. The skill never edits code, fixes findings, opens PRs, or changes the goal package except REVIEW.md.
---

# risoluto-review-handoff

Package the final review that the `/goal` conductor (Codex or Claude Code) will ingest. The reviewer is deliberately not the
same loop that implemented the branch. The output is a structured `review-handoff.v1` artifact, not prose
advice.

This skill is reviewer/packager only. It does not edit code.

## Preconditions

Stop and report the exact failure if any check fails.

| Check                     | Verification                                                               | Failure path                                 |
| ------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Repo root                 | `test -f package.json && test -f .gitmodules`                              | Tell Omer to run from the Risoluto checkout. |
| Slug provided             | `<slug>` argument exists                                                   | Ask for the PRD slug.                        |
| PRD exists                | `docs/prds/<slug>.md` exists                                               | Run `/risoluto-to-prd <slug>` first.         |
| Goal folder exists        | `~/.risoluto/goals/<slug>/GOAL.md` exists                                  | Run `/risoluto-goal-prep <slug>` first.      |
| Integration branch exists | `git rev-parse --verify integration/<slug>` or `origin/integration/<slug>` | Nothing is ready to review.                  |
| Linear reachable          | `LINEAR_API_KEY` GraphQL probe succeeds, or Linear MCP is available        | Surface the error; do not retry auth.        |

## Review Model Rule

Use a different model/reviewer from the `/goal` implementer. The point is a fresh model, not a specific
vendor: if the cascade ran in Codex, review from Claude Code; if it ran in Claude Code, review from Codex (or
another model). If only the implementing loop is available, stop and ask Omer for a different-model review
surface; do not self-review and call it the end gate.

## Pipeline

### Step 1 - Assemble Inputs

Collect:

- diff: `git fetch origin` then `git diff origin/master...integration/<slug>`;
- PRD: `docs/prds/<slug>.md`, especially User Stories, Implementation Decisions, Testing Decisions, Out of Scope;
- wave map: `~/.risoluto/goals/<slug>/WAVES.md`;
- Linear issues labelled `from:prd-<slug>` with descriptions, states, and acceptance criteria;
- latest gate evidence from `~/.risoluto/goals/<slug>/NOTES.md`.

Review the branch against the PRD and issues, not just against TypeScript correctness.

### Step 2 - Review Lenses

Prioritize:

1. Correctness bugs in the diff.
2. **Production reachability.** A green gate proves the modules work in isolation, not that anything runs. For
   each capability the PRD says an operator can invoke (a CLI command, an HTTP/webhook request, a Slack
   action), confirm the production path actually reaches the engine — the entry point dispatches to a handler
   that is _wired_, not just exported. A load-bearing function called only from tests is an unshipped feature
   wearing a green check. This is the gap a same-loop reviewer most reliably misses.
3. Acceptance gaps where a PRD story or Linear criterion is not actually satisfied.
4. Invariant violations: tracker id used as run id, artifact validation skipped, PR action automated, cascade
   residue committed, or PRD Out of Scope implemented.
5. Test honesty: gate green but load-bearing behavior not exercised — including acceptance/e2e/capstone tests
   that hand-compose modules or stub the entry point (canned role/action/provider outputs) instead of driving
   the real CLI/HTTP/webhook/Slack path. If the capstone wires everything by hand, it proves the pieces, not
   the product.
6. Scope creep that should become a `discovered` Linear issue.

For lens 2, the cheapest high-signal probe: pick the load-bearing symbols (the engine entry, each adapter's
intake function, each handler) and grep for **non-test** callers, e.g.
`rg -n "executeWorkflowDefinition" src --glob '!*.test.ts'`. Zero production callers, or callers that exist
only in `tests/`, is a HIGH reachability finding. Cross-check parity across sibling adapters — if Linear is
wired and GitHub is not, the asymmetry is the bug.

For API, workflow-run, storage/archive, workflow-definition, or schema findings, name the contract surface
the conductor should re-run when practical, such as OpenAPI contracts or `pnpm run test:integration`.

### Step 3 - Emit `review-handoff.v1`

Write `~/.risoluto/goals/<slug>/REVIEW.md` using `references/review-handoff.v1.md`:

- human-readable summary first;
- fenced `json` block with `contract: "review-handoff.v1"`;
- `summary: { high, med, nit }`;
- prioritized `findings[]`;
- each finding has `id`, `severity`, `file`, `line`, `problem`, `fix`, `trace`, and `status: "open"`.

Severity contract:

- `HIGH`: blocks PR; correctness bug, unmet acceptance criterion, or invariant violation.
- `MED`: should fix; not blocking by itself.
- `NIT`: optional polish.

Every finding must include a concrete fix and trace back to a PRD story, issue id, ADR, or gate invariant.
Drop vague findings instead of handing them to the conductor.

### Step 4 - Publish the Handoff

Add the same review summary as a Linear comment on the PRD's highest-level tracking issue. If no parent issue
exists, comment on the first `from:prd-<slug>` issue and include the goal folder path.

Do not fix findings. Print:

```text
Review handoff written to ~/.risoluto/goals/<slug>/REVIEW.md. Resume the /goal conductor; HIGH findings block the PR command.
```

## Companion Files

- `references/review-handoff.v1.md` - artifact contract and example.
- `../references/linear-access.md` - GraphQL comment and issue queries.
- `skills/risoluto-goal-prep/` - generates the package the review belongs to.
- `skills/risoluto-goal-run/` - the Claude runner that resumes and consumes REVIEW.md.
