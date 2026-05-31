---
name: risoluto-review-handoff
description: Produce the end-review artifact for a Risoluto AFK goal. Use for /risoluto-review-handoff <slug> after integration/<slug> has all waves merged. A different model reviews integration/<slug> against docs/prds/<slug>.md and the Linear issues, then writes review-handoff.v1 to ~/.codex/goals/<slug>/REVIEW.md and a Linear comment. The skill never edits code, fixes findings, opens PRs, or changes the goal package except REVIEW.md.
---

# risoluto-review-handoff

Package the final review that the Codex `/goal` conductor will ingest. The reviewer is deliberately not the
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
| Goal folder exists        | `~/.codex/goals/<slug>/GOAL.md` exists                                     | Run `/risoluto-goal <slug>` first.           |
| Integration branch exists | `git rev-parse --verify integration/<slug>` or `origin/integration/<slug>` | Nothing is ready to review.                  |
| Linear reachable          | `LINEAR_API_KEY` GraphQL probe succeeds, or Linear MCP is available        | Surface the error; do not retry auth.        |

## Review Model Rule

Use a different model/reviewer from the Codex `/goal` implementer. Preferred path: run this skill from Claude
Code or another non-Codex reviewer. If only the implementing Codex loop is available, stop and ask Omer for a
different-model review surface; do not self-review and call it the end gate.

## Pipeline

### Step 1 - Assemble Inputs

Collect:

- diff: `git fetch origin` then `git diff origin/master...integration/<slug>`;
- PRD: `docs/prds/<slug>.md`, especially User Stories, Implementation Decisions, Testing Decisions, Out of Scope;
- wave map: `~/.codex/goals/<slug>/WAVES.md`;
- Linear issues labelled `from:prd-<slug>` with descriptions, states, and acceptance criteria;
- latest gate evidence from `~/.codex/goals/<slug>/NOTES.md`.

Review the branch against the PRD and issues, not just against TypeScript correctness.

### Step 2 - Review Lenses

Prioritize:

1. Correctness bugs in the diff.
2. Acceptance gaps where a PRD story or Linear criterion is not actually satisfied.
3. Invariant violations: tracker id used as run id, artifact validation skipped, PR action automated, cascade
   residue committed, or PRD Out of Scope implemented.
4. Test honesty: gate green but load-bearing behavior not exercised.
5. Scope creep that should become a `discovered` Linear issue.

### Step 3 - Emit `review-handoff.v1`

Write `~/.codex/goals/<slug>/REVIEW.md` using `references/review-handoff.v1.md`:

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
Review handoff written to ~/.codex/goals/<slug>/REVIEW.md. Resume the Codex /goal; HIGH findings block the PR command.
```

## Companion Files

- `references/review-handoff.v1.md` - artifact contract and example.
- `../references/linear-access.md` - GraphQL comment and issue queries.
- `skills/risoluto-goal/` - conductor that consumes REVIEW.md.
