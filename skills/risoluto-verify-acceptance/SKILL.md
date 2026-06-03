---
name: risoluto-verify-acceptance
description: Cross-model, per-issue acceptance-criteria verification before merge — a different model (via opencode) checks that the implementation actually satisfies EVERY Linear acceptance criterion. Use when Omer says /risoluto-verify-acceptance, "cross-check the acceptance criteria", "does NIN-123 actually meet its acceptance criteria", "independent acceptance check before merge", or "verify the DoD with a different model". Takes a <ticket-ref>, assembles a packet (the issue's acceptance criteria + relevant PRD sections + the branch diff + the tests added), runs an adversarial opencode review under a model different from the implementer, and reports a per-criterion met | not-met | unverifiable verdict with a citation or the gap. Distinct from /risoluto-review-handoff (goal-level code review) and /risoluto-pre-pr (same-model advisory). It never merges, edits code, ticks Linear boxes, or opens a PR — it produces a verdict.
---

# risoluto-verify-acceptance

The **cross-model acceptance gate**. The git history proves the failure it exists to catch: a model
codes the Definition-of-Done and _misses_ it — `reconfirmPostPublishVerification` and `completeAutoMerge`
shipped test-only; `buildSingleVerifierInput` ran with `evidenceLinks: []`. A same-model review
structurally misses these because it shares the implementer's blind spots. This skill asks a **different
model** (through `opencode`) one narrow question per ticket: does the merged code actually satisfy every
acceptance criterion, with proof?

It is per-issue and acceptance-focused — narrower than `/risoluto-review-handoff` (a different-model
_code_ review over the whole `integration/<slug>` branch) and independent of `/risoluto-pre-pr` (the
same-model advisory cleanup). Run it on a ticket branch before its merge, or on any issue you doubt.

## Hard preconditions

| Check               | Verification                                                                   | If it fails                                                      |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Run from repo root  | `test -f package.json && test -f .gitmodules`                                  | Tell Omer to `cd` into the Risoluto checkout root.               |
| Ticket ref provided | argv matches `[A-Z]+-\d+`                                                      | Ask Omer for the Linear ticket ref.                              |
| Linear reachable    | get-issue probe succeeds                                                       | Surface the error verbatim; do not retry auth.                   |
| Issue has ACs       | the issue description has a non-empty `## Acceptance criteria`                 | Nothing to verify — sharpen the issue first.                     |
| Branch has a diff   | `git diff <base>...HEAD` (base = `integration/<slug>` or default) is non-empty | Check out the ticket branch first.                               |
| opencode available  | `command -v opencode`                                                          | Install opencode or run the same check by hand in another model. |

## Pipeline

### Step 1 — Assemble the verification packet

Write a single packet file (e.g. `/tmp/risoluto-ac-<ticket>.md`) containing, clearly delimited:

- **Acceptance criteria** — the issue's `## Acceptance criteria` block, verbatim, each line numbered.
- **PRD context** — the relevant `docs/prds/<slug>.md` sections (Implementation/Testing Decisions,
  the User Stories the issue covers, Out of Scope) resolved from the `from:prd-<slug>` label.
- **Diff** — `git diff <base>...HEAD` for the ticket branch (`<base>` = `integration/<slug>` if it
  exists, else the default branch).
- **Tests added** — the list of test files in the diff, so the reviewer can check each criterion maps
  to a test, and whether that test drives a real entry point or stubs it.

### Step 2 — Run the cross-model check (opencode, different model)

Pick a model **different from the implementer** (if Claude built it, review in a non-Claude model, and
vice-versa). Run opencode non-interactively, bypassing plugins so the broken `oh-my-opencode-slim`
council fan-out cannot interfere — **plain `run`, `--pure`, no `--agent`**:

```bash
opencode run --pure --model <provider/model> --format json -f /tmp/risoluto-ac-<ticket>.md "$(cat <<'PROMPT'
You are an adversarial acceptance reviewer. For EACH numbered acceptance criterion in the attached
packet, decide one of: MET | NOT_MET | UNVERIFIABLE.
- MET requires a concrete citation: the test name OR the production entry point in the diff that proves
  the behaviour. A criterion describing operator-visible behaviour (CLI/HTTP/webhook/Slack) is MET only
  if a test drives it through the REAL entry point AND a non-test caller reaches the code — an exported
  symbol called only from tests is NOT_MET (reachability gap).
- Default to NOT_MET when you cannot point at proof. Do not be charitable.
- UNVERIFIABLE only if the criterion is not falsifiable from the diff alone.
Output a JSON array: [{ "n": <number>, "criterion": "<text>", "verdict": "...", "proof_or_gap": "..." }].
PROMPT
)"
```

`opencode models` lists available `provider/model` ids. If opencode errors or returns no parseable
verdict, **surface it verbatim and stop** — never fabricate a pass.

### Step 3 — Ingest the verdict and report

Parse the JSON. Emit a per-criterion table plus the overall gate:

```
verify-acceptance: <ticket>  model: <provider/model>
  1  MET           tests/run-start-reachability.integration.test.ts → drives `risoluto run start`
  2  NOT_MET       evaluateCiBabysitter reachable only via tests; pollCi never injected in production
  3  UNVERIFIABLE  "evidence is redacted" — needs a live run, not visible in the diff
VERDICT: BLOCK (1 NOT_MET, 1 UNVERIFIABLE) — resolve before merge
```

GATE: **CLEARED** only when every criterion is MET. Any NOT_MET → **BLOCK**, listing the gaps. Surface
UNVERIFIABLE criteria for the operator to judge.

Also persist the verdict so a goal-level review can roll it up. Write `ac-verify.v1` JSON to
`~/.risoluto/goals/<slug>/ac-verify-<ticket>.json` (create the dir if absent; `<slug>` is the
`from:prd-<slug>` slug from Step 1):

```json
{
  "contract": "ac-verify.v1",
  "ticket": "<ticket>",
  "slug": "<slug>",
  "model": "<provider/model>",
  "gate": "CLEARED | BLOCK",
  "checked_at": "<ISO8601 UTC, from `date -u +%Y-%m-%dT%H:%M:%SZ`>",
  "verdicts": [{ "n": 1, "criterion": "...", "verdict": "MET | NOT_MET | UNVERIFIABLE", "proof_or_gap": "..." }]
}
```

Overwrite any prior file for the same ticket (idempotent — the latest run is the truth). This file is the
input `/risoluto-review-handoff` Step 1 aggregates into its `ac_summary`.

### Step 4 — Record (optional, idempotent)

Offer to post the verdict as a Linear comment on the ticket using the marker convention
(`<!-- risoluto:ac-verify -->` — skip if a prior verdict comment exists). This is evidence, not a status
write: it does **not** tick acceptance boxes (that is `/risoluto-tdd` Step 5 / `/risoluto-sync`, from
proof) and does not change issue status.

## Invariants & notes

- **Cross-model is the whole point.** Use a model different from the one that implemented the slice; a
  same-model check reproduces the implementer's blind spots. If only the implementer's model is
  available, say so and stop — do not self-verify and call it the gate.
- **Adversarial, proof-or-NOT_MET.** Green suite ≠ met; reachability (non-test caller) is part of MET.
  This is the per-issue analogue of the `verification-ladder` bar and `/risoluto-review-handoff` lens 2.
- **Verdict only.** It never merges, edits code or git, ticks Linear boxes, or opens a PR.
- **Plugins off.** Always `--pure`, never `--agent` — the installed `oh-my-opencode-slim` agent prompts
  do not apply under this opencode build, so the council/agent path is unreliable.
- **Idempotent.** Re-runs re-derive the packet and re-skip an existing verdict comment.

## Companion files

- `skills/risoluto-tdd/` — owns building the slice and ticking ACs from proof at PR-open.
- `skills/risoluto-review-handoff/` — the goal-level different-model code review (broader, per-goal).
- `skills/risoluto-sync/` — reconciles Linear from proof; this skill's verdict is an input to that.
- `docs/research-to-shipping-pipeline.md` — where this gate sits in the back-half state machine.
