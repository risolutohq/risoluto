---
name: risoluto-clawpatch
description: Native whole-repo, slice-by-slice code review for the Risoluto repo — a clawpatch-style sweep that maps the codebase into semantic feature slices, reviews every slice across all 10 finding categories, merges and de-dupes, adversarially verifies each finding so survivors are accurate, and writes a review-handoff.v1 markdown a fresh session can pick up to fix. Use whenever Omer says /risoluto-clawpatch, "clawpatch the repo", "do a whole-repo review", "sweep the codebase for bugs", "review the whole project slice by slice", "find all the findings and verify them", "give me a review handoff for a new session", or any variation that asks for a verified, handoff-ready findings list across the entire repo (not just the current diff). This is the WHOLE-REPO sweep — distinct from /code-review and /simplify (current diff only), /risoluto-pre-pr (one ticket branch), and /risoluto-review-handoff (one PRD/goal branch). It reviews and hands off only; it never fixes code, ticks tracker boxes, or opens a PR. Invoking it is the explicit opt-in to multi-agent orchestration (it fans out many subagents via the Workflow tool).
---

# risoluto-clawpatch

A native re-implementation of what the external `openclaw/clawpatch` CLI does, built entirely
from Claude subagents via the **Workflow tool** — no dependency on the external `clawpatch`
binary, the `codex` provider, or `/tmp/cp-state1/` state.

The work lives in the co-located Workflow script `workflow.mjs`. This file is the thin wrapper:
it resolves inputs, runs that Workflow, lands the handoff file, and reports. **It does not review
code itself** — the subagents do. Keep the orchestration here; keep the reviewing in the script.

The pipeline the script runs: **Map** (one mapper agent per spine layer → semantic feature
slices) → **Review** (one reviewer per slice, all 10 categories, Sonnet) → **Merge/dedupe**
(plain code, cross-slice) → **Verify** (one combined skeptic per finding runs all three lenses —
evidence / reasoning / impact — in a single Opus pass, refute-or-keep) → **Handoff** (synthesize
a `review-handoff.v1` markdown).

## Why this shape

A 52.9k-LOC repo is not reviewable in one pass, so it is sliced. Prior sweeps on this repo ran
**34–50% false-positive** (the reviewing model's own triage was wrong a third to half the time),
so the load-bearing stage is **Verify**, not Review: every finding is attacked by an adversarial
skeptic whose job is to refute it. The skeptic runs all three lenses — evidence (does the quote
still exist?), reasoning (can the failure actually occur?), impact (is it reachable in
production?) — in one Opus pass, and a finding is killed only when the skeptic can **concretely
disprove** it on at least one lens; borderline findings are kept (and flagged `unverified`) for
the deeper downstream review rather than culled by one over-eager pass. That layered accuracy —
wide-net Review casts, adversarial Verify culls the obvious FPs, the downstream fixing session
re-reviews each survivor before touching code — is the point. Review runs on Sonnet (cheap, high
recall); Verify and synthesis run on Opus.

**Hard limits (learned the expensive way).** The harness caps a workflow at **1000 agents** for
its lifetime, and the Claude session has a rolling **token/usage window**. A 3-skeptics-per-finding
panel over ~300 findings needs ~900 verify agents and ~10M tokens and blows **both** — the run
dies mid-Verify with no handoff (this happened: 7 maps + 106 reviews + 887 skeptics = the 1000
cap, after the session limit had already turned ~750 skeptics into no-ops). So Verify uses **one**
combined skeptic per finding (~3× cheaper, every finding checked, no deferral), the script
hard-caps the fan-out (`MAX_AGENTS`), and a crashed/limited skeptic is a non-event — the finding
survives flagged `unverified`, never silently dropped as if refuted. For a genuinely huge finding
set the cap defers the lowest-severity tail and `log()`s it.

It stops at the handoff on purpose. A fresh session — or the `/goal` conductor — fixes from the
artifact. Mixing "find" and "fix" in one run is how a 50%-FP list quietly rewrites correct code.

## Preconditions

Stop and report the exact failure if a check fails.

| Check     | Verification                                       | Failure path                                 |
| --------- | -------------------------------------------------- | -------------------------------------------- |
| Repo root | `git rev-parse --show-toplevel` resolves           | Tell Omer to run from the Risoluto checkout. |
| Clean-ish | `git status -sb` (record it; do not require clean) | Note a dirty tree in the report header.      |

The review is read-only, so a dirty worktree is allowed — but record it, because findings cite
lines that uncommitted edits may have moved.

## Inputs

Default is a **whole-repo** sweep. Resolve these before launching:

- `date` — today's date `YYYY-MM-DD` (the Workflow script cannot call `Date.now()`; you must
  pass it). Use `date +%F`.
- `root` — `git rev-parse --show-toplevel`.
- `branch` — `git rev-parse --abbrev-ref HEAD`.
- `base` — `origin/master` unless Omer names another.
- `changedFiles` — **only** for a diff-scoped run. If Omer asks to review "what changed" / "this
  branch" / passes `--since <ref>`, compute
  `git diff --name-only --relative <ref>...HEAD` and pass the array. The script then reviews only
  the slices that touch those files. Omit (or pass `[]`) for the full sweep.

## Run the Workflow

This is the multi-agent step. Invoke the Workflow tool against the co-located script by absolute
path (it travels with the skill, symlinked into `.claude/skills/`):

```
Workflow({
  scriptPath: "<root>/skills/risoluto-clawpatch/workflow.mjs",
  args: { date, root, branch, base, changedFiles, reviewedBy: "<your model id>" }
})
```

- The Workflow returns immediately with a run id and runs in the background; you are notified on
  completion. Watch progress with `/workflows` if you like.
- **Scale.** A whole-repo sweep fans out to a few hundred subagents: typically 7 mappers + ~100
  reviewers + ~300 skeptics (one per deduped finding) + 1 synth ≈ ~400 agents, ~7–8M tokens. The
  1000-agent cap and 5-hour session token window are both real and were both hit by the first
  attempt (3 skeptics/finding × 300 findings blew both). The current single-skeptic design fits
  comfortably but `MAX_AGENTS` is still wired as a backstop — if a run ever exceeds it, the
  lowest-severity findings are deferred unverified and `log()`ed. A skeptic crash (StructuredOutput
  failure, session limit) is caught by a try/catch and the finding survives flagged `unverified`
  instead of being silently lost. Token cost is dominated by reviewers re-reading source
  (cache-read, ~138M for a full repo); if a run dies on the session window, **resume** (below) —
  Map+Review return from cache for free, only Verify+Handoff re-run.
- **Resume.** If a run is interrupted, re-launch with
  `Workflow({ scriptPath, resumeFromRunId: "<run id>", args: <same args> })`. Map and Review
  results are cached on unchanged `(prompt, args)`, so only Verify onward re-runs. Keep `args`
  (especially `date`) identical or the cache misses.

## Land the handoff

The Workflow returns `{ handoffMarkdown, handoff, stats }`. The script has no filesystem access,
so **you** write the file (this keeps the write verifiable and in your hands):

1. `mkdir -p <root>/reviews`
2. Write `handoffMarkdown` verbatim to `<root>/reviews/<date>-sweep.md`.
3. Validate the embedded contract — extract the fenced ```json block and check it parses and is
`review-handoff.v1`:
   ````bash
   awk '/^```json$/{f=1;next} /^```$/{f=0} f' reviews/<date>-sweep.md \
     | jq -e '.contract=="review-handoff.v1" and (.findings|type=="array")' >/dev/null \
     && echo "handoff JSON valid" || echo "HANDOFF JSON INVALID — re-synthesize"
   ````
   If invalid, resume the run (`resumeFromRunId`) so only the Handoff stage re-runs.

## Report and stop

Print a terse summary and the path — nothing else acts on the findings:

```text
clawpatch sweep complete — reviews/<date>-sweep.md
slices: <stats.slices>  |  raw <stats.raw> -> deduped <stats.deduped> -> confirmed <confirmed> (<stats.dropped> refuted, <stats.deferred> deferred, <stats.unverified> unverified)
summary: <high> HIGH, <med> MED, <nit> NIT  (HIGH blocks any PR a fixer opens)
next: hand reviews/<date>-sweep.md to a fresh session to fix; the embedded review-handoff.v1 JSON is conductor-parseable.
```

**Never** fix the findings, **never** run `gh pr create`, **never** touch Linear from this skill —
those belong to the fixing session (`/risoluto-tdd`) and the conductor, after the human reads the
handoff. The pipeline rule holds: this skill prints the next command, it does not run it.

## The handoff contract

The output matches **`review-handoff.v1`** — schema and example at
`skills/risoluto-review-handoff/references/review-handoff.v1.md`. The slug is
`clawpatch-sweep-<date>` (a whole-repo sweep has no PRD; this mirrors the architecture-loop
bypass). The markdown carries both a human-readable HIGH/MED/NIT list with reasoning, fix scope,
and a suggested regression test per finding, **and** the fenced `review-handoff.v1` JSON block so
the `/goal` conductor can walk `findings[]` and flip each `status` to `resolved` as it fixes.

## Tuning the review (edit `workflow.mjs`)

Everything substantive lives in the script — adjust it there, not here:

- **Slices** — `DEFAULT_LAYERS` maps the 7 spine layers to their `src/` modules. Add a layer or
  re-home a module here; mappers split anything oversized at functional seams.
- **Categories** — `CATEGORIES` is the full clawpatch set. The Review casts wide and Verify culls,
  so this is deliberately broad.
- **False-positive guards** — `FP_GUARDS` encodes this repo's hard-won FP patterns (Express 5
  async-handler rejections are framework-handled; no coverage-only test-gaps; `issueId` is a
  legitimate tracker coordinate; the two known deferred-as-unsafe edits). These are injected into
  both the Review and Verify prompts. When a new systematic false positive shows up, add it here —
  that is how the sweep gets sharper over time.
- **Verify strength** — `REFUTE_LENSES` (evidence / reasoning / impact) are all run by a single
  combined skeptic per finding (`SKEPTICS_PER_FINDING = 1`); a finding is killed only on concrete
  refutation. To make Verify stricter, add a lens, sharpen the refute calibration in
  `refutePrompt`, or raise `SKEPTICS_PER_FINDING` back to a multi-skeptic vote — but mind the
  1000-agent / token-window limits in "Why this shape" (a multi-skeptic panel over a whole-repo
  finding set will not fit one run).
- **Model tiers** — Review on `sonnet`, Verify and synthesis on `opus`. Change per-agent `model`
  opts if the cost/accuracy trade shifts.
