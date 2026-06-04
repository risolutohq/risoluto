# DISCOVERY — Risoluto pipeline forensic audit (Phase 0 + 1)

> Session: _Harden the Risoluto pipeline into a deterministic, self-healing build machine._
> Date: 2026-06-02. Method: 22-agent discovery fan-out (10 session-transcript miners over 86 MB of
> JSONL, git narrative + reachability-miss hunt, 8-skill state-machine audit, 2 adversarial grills)
>
> - main-loop reads of every back-half skill, the conductor script, CI, hooks, and Linear (RIS).
>   **Convention:** every claim is marked **[C]** confirmed-in-repo (read directly) or **[I]** inferred
>   (from transcripts / cross-reference, not line-verified). This file is a session working artifact.

---

## 0. TL;DR — the five things that matter

1. **The reachability regression is real and proven.** [C] The `workflow-first-afk-mvp` engine
   (RIS-194..222, ~9.5k lines, 27 issues "Done") shipped with **two symbols test-only** (zero prod
   callers) and **five partial** (production honest-blocks because the dogfood capstone injected
   fakes). The green gate + capstone passed _because_ the capstone hand-injected `pollCi`,
   `prepareWorkspace`, `retryGate`, `dispatchRole`. This is exactly the gap that already spawned the
   `verification-ladder` PRD.
2. **`verification-ladder` already owns Themes B/D/E's core.** [C] Roadmap row #2 (`building`) is a
   full PRD sliced into 9 Linear issues (RIS-225..233): static `reach:check` gate, e2e intake tier,
   wire-into-gate+CI, and **in-loop DoD edits to tdd/to-issues/review-handoff**. We must not rebuild
   it — only align and target the gaps it doesn't cover.
3. **Linear is drifting from git with no deterministic repair.** [C] RIS-212, RIS-218 are `Todo` and
   RIS-222 is `Backlog` though their code is merged. `post-merge-prd.mjs` flips _PRD/roadmap_ status
   and back-comments — it **never flips issue status to Done**. Issue-Done is purely an LLM action.
4. **The AFK conductor cannot guarantee finishing all issues — by construction.** [C] One stuck issue
   (`mergedIds.length===0`) → `blockedWave` → `break` halts the whole downstream cascade; there is no
   skip-and-continue, no retry/back-off, and **a null gate-agent return breaks the loop without
   writing the PLAN.md blocker** (silent loss of why it stopped). Discovered issues (RIS-222) are
   orphaned from the frozen `WAVES.md`.
5. **Determinism is mostly prose.** [C] The load-bearing guards — "print `gh pr create` only if
   v1-check green", "new behaviour ⇒ new test", "every AC has a mapped test", reachability,
   slug-consistency — are **model-judgment instructions, not enforced**. The one documented slug
   consistency check **does not exist in code**. Existing hooks infra (`.claude/settings.json`) makes
   adding real guards cheap.

---

## 1. What we built (last 3 days) — [C] git + Linear

**`workflow-first-afk-mvp`** (roadmap #1, `building`): configurable Workflow Runs that execute AFK
engineering work across CLI / Slack / HTTP / tracker intake / worktrees / PR-CI / verifier / evidence
/ memory / handoff. 97 commits on one `integration/workflow-first-afk-mvp` branch, merged to master
via PR #10 (`0cc3bd9`). Waves:

| Wave | Milestone            | Issues                                                      | Linear status        |
| ---- | -------------------- | ----------------------------------------------------------- | -------------------- |
| 1    | Foundation roots     | RIS-194,195                                                 | 100% Done            |
| 2    | Walking skeleton     | RIS-196,197,198,199                                         | 100% Done            |
| 3    | Engine controls      | RIS-200,201,205,206,207,211                                 | 100% Done            |
| 4    | External surfaces    | RIS-202,203,204,208,209,210,**212**,213,214,215,216,219,220 | 92% (RIS-212 `Todo`) |
| 5    | Readiness/dogfood    | RIS-217, **218**                                            | 50% (RIS-218 `Todo`) |
| —    | discovered mid-build | **RIS-222**                                                 | `Backlog`            |

**Pipeline skills built/hardened:** the back-half chain `to-prd → to-issues → tdd → pre-pr →
goal-prep → goal-run → review-handoff`, plus `next-bundle`, and the front-half `researcher / grill /
ingest / features / vault`. `risoluto-pre-pr` (Stage 3.5) and the runner-agnostic `goal-prep` +
Claude-native `goal-run` conductor were the most recent additions. Hooks added to
`.claude/settings.json` (PostToolUse→prettier, Stop→`stop-ts-check.sh`); pre-push path-gated for
docs-only; ESLint `max-lines*` ceilings dropped (only `complexity:15` remains).

**`verification-ladder`** (roadmap #2, `building`): PRD + 9 Linear issues (see §8).

**[I] from transcripts** — the build was punctuated by Omer corrections that encode standing rules:
no auto-PR (skills print `gh pr create`); don't spin up a second PRD to fix the first; reopen stuck
ACs lazily one at a time, not all 23 at once; Claude reviews **once at the end**, not mid-cascade;
`~/.codex/auth.json` (PKCE) is the agent auth, not `OPENAI_API_KEY`/cliproxy.

---

## 2. What's half-wired / regressed — [C] reachability proof (git-miss hunt)

The dogfood capstone (RIS-218) passed by injecting fakes, masking that the production binary
honest-blocks. Per-symbol verdict:

| Issue              | Symbol                               | Verdict       | Why                                                                |
| ------------------ | ------------------------------------ | ------------- | ------------------------------------------------------------------ |
| RIS-198            | `driveAcceptedWorkflowRun`           | **satisfied** | reached from `risoluto run start`                                  |
| RIS-200            | `persistExecutorEvents`              | **satisfied** | unconditional on every drive                                       |
| RIS-211            | `createWorkflowRunActionRunner`      | **satisfied** | 2 prod callers                                                     |
| RIS-215            | `evaluatePrPublishPolicy`            | **satisfied** | runs via `publish-pr` action                                       |
| RIS-204/214        | evidence + memory hooks              | **satisfied** | unconditional in drive path                                        |
| keystone (69957ed) | daemon subscriber                    | **satisfied** | all 4 intakes → real _blocked_ handoff.v1                          |
| RIS-196            | `createWorkflowRunWorkspacePreparer` | **partial**   | zero prod instantiation → no-op branch                             |
| RIS-216            | `WorkflowRunCiPoller`                | **partial**   | `pollCi` never injected → honest-block                             |
| RIS-206            | gate-retry                           | **partial**   | `retryGate` never injected → blocks instead                        |
| RIS-201/207        | `buildSingleVerifierInput`           | **partial**   | `evidenceLinks:[]` hardcoded empty                                 |
| RIS-222            | `createWorkflowRunAgentDispatch`     | **partial**   | CLI-only behind `RISOLUTO_LIVE_RUN_START`; daemon path never wired |
| RIS-219            | `reconfirmPostPublishVerification`   | **test-only** | 0 prod callers; only importer also dead                            |
| RIS-220            | `completeAutoMerge`                  | **test-only** | referenced only in comments                                        |

**[I]** Cross-model review of the branch (different Claude agents) found the engine was never wired
into `src/cli`/`src/http` for live; legacy `src/orchestrator/` still runs the live path. Same-model
(gpt-5.5) self-review missed it. Confirms: **same-loop review structurally misses reachability.**

**Suspicious fix-of-fix commits [C]:** `5dd29ddd` then `f94ae03` (two consecutive omnibus
"resolve AFK review findings"), `c776d8f` ("make write-handoff a **no-op** so accepted runs reach
done" — band-aid; capstone injected its own runAction), `c35010c` (missing `Bearer` prefix),
`3b9bb93` (codex PTY under cap-drop), `947752f`+`e1af830` (two drift-check fixes 90 min apart). All
trace to capstone-masked production paths.

---

## 3. Linear as memory layer — [C] the drift is structural

- `post-merge-prd.mjs` does: find issues by `from:prd-<slug>` label → `commentCreate` back-comment →
  flip PRD frontmatter `status: shipped` → flip roadmap row. It **never calls `issueUpdate`**, so
  issue status is never set Done by CI. [C]
- `goal-run` says the conductor's merge-agent marks Done; `tdd` says "moving it to Done is the
  operator's call… never the skill's." **Contradiction** → in practice neither fires reliably → RIS-212/218
  stuck `Todo`, RIS-222 `Backlog` despite merged code. [C]
- `commentCreate` has **no dedup** → duplicate back-comments on any re-run, in `tdd`, `goal-run`,
  `review-handoff`, _and_ `post-merge-prd.mjs`. [C] Systemic.
- `post-merge.yml` triggers on **any** `pull_request.closed` carrying a `from:prd-*` label with **no
  base-branch guard** → a per-ticket `feat→integration` PR merge flips the PRD to `shipped`
  prematurely and back-comments all issues. [C] (HIGH)

---

## 4. State-machine map — [C] reads / writes / guard / idempotency per back-half step

| Step               | Reads                                                                                     | Writes                                                                                                      | Hard guards                                                                                                                                        | Idempotent?                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **to-prd**         | roadmap row, research target/wiki, RISOLUTO_FEATURES; PRD (sync)                          | `docs/prds/<slug>.md`, roadmap status, `pipeline/<slug>-prd` branch, Linear Project create/update           | exit1: missing repo/submodule/roadmap/slug; CREATE refuses if PRD or branch exists; clean-tree                                                     | **partial** — CREATE not idempotent (refuses; partial run leaves dirty tree, manual cleanup). SYNC re-POSTs Linear each run, re-dirties `synced_at`        |
| **to-issues**      | PRD body+fm, roadmap, existing `from:prd-<slug>` issues                                   | flat Linear issues, blocked-by/related, 5 labels, wave milestones, PRD attachments                          | exit1: missing repo/submodule/PRD/`linear_project`/Linear; Step 0 reconcile on re-run; 8-check slice-quality gate; refuse issue w/o falsifiable AC | **no** — Step 0 reconcile is operator-gated, not mechanical; milestone create has no uniqueness check                                                      |
| **tdd**            | issue (title/desc/labels/blocked-by + each blocker status), PRD, TDD companions, git tree | worktree+branch, code+tests, commits, issue→In Progress, AC reconcile, PR back-comment, `discovered` issues | refuse if blocked-by not Done / no `from:prd` label / no PRD / dirty tree / PRD-out-of-scope; never run `gh pr create`; tick AC only from proof    | **no** — worktree path is the lock (hard git error on re-run, not graceful); back-comment dups; AC edit overwrites manual edits; **no Step 0 reconcile**   |
| **pre-pr**         | branch diff only                                                                          | in-tree fixes, simplify edits, commit+push, printed `gh pr create`                                          | empty-diff stop; **mandatory `/v1-check`** if code changed → STOP on red; never auto-apply unpicked fix                                            | **partial** — Step 5 makes a new commit each run; `/simplify` re-applies; no double-cleanup guard                                                          |
| **next-bundle**    | Linear ready-set, PRDs                                                                    | nothing (conversation only)                                                                                 | read-only                                                                                                                                          | **yes**                                                                                                                                                    |
| **goal-prep**      | PRD, Linear milestones+issues                                                             | `~/.risoluto/goals/<slug>/{GOAL,SPEC,WAVES,CONTROL,PLAN,ATTEMPTS,NOTES}.md`                                 | exit unless `--force`; `--force` wipes dir                                                                                                         | **partial** — `--force` wipes PLAN/ATTEMPTS/NOTES (resume state) with no lock when conductor active                                                        |
| **goal-run**       | WAVES.md, live Linear blocker state, CONTROL.md                                           | integration/wave/issue branches, merges, Linear Done+comments, PLAN/ATTEMPTS/NOTES                          | hard stops: gate-red-after-one-repair, conflict, missing creds, ADR/PRD conflict, budget; print-only PR                                            | **partial** — safe only via `resumeFromRunId`; cold re-run recreates existing branches, dup merge-comments, append dup blockers, stale-worktree collisions |
| **review-handoff** | diff vs master, PRD, WAVES, Linear issues, NOTES gate evidence                            | `REVIEW.md` (review-handoff.v1), Linear comment                                                             | different-model rule; HIGH blocks PR (prose)                                                                                                       | **partial** — overwrites REVIEW.md silently; Linear comment dups; re-run resets conductor's `resolved` markers                                             |

**Unverified seams (output not provably the next input) [C]:**

- **Slug join key** is assumed identical across roadmap `<!-- slug -->` / PRD filename / `prd.slug` /
  `from:prd-<slug>` label, but the documented 4-field check **does not exist** (`validate-research.ts`
  checks only filename↔frontmatter + source format).
- **`from:prd-<slug>` label on PR** is applied manually _after_ the operator opens the PR; if skipped,
  post-merge silently no-ops ("No from:prd-\* label found").
- **WAVES.md is frozen at render** — `goal-run` Step 1 refreshes only blocker _state_, not AC text /
  blocked-by edges / milestone membership; PRD edits mid-cascade are invisible.
- **Conductor `doneIds` is a local set, not live Linear** — a merge-agent whose Linear Done-call fails
  still returns `mergedIds`, so the conductor unblocks downstream "on a lie."
- **BUILD_SCHEMA evidence is a free string** — no `testsAdded`, no proof a real `/risoluto-tdd` ran.

---

## 5. Idempotency audit — [C] systemic, not "two known gaps"

The doc claims only `to-issues` is non-idempotent (Known Gaps) while the Invariants line also names
`tdd`. Reality: **every stateful back-half skill has idempotency hazards**, with two recurring root
causes:

1. **`commentCreate` never dedups** → duplicate Linear comments (tdd, goal-run, review-handoff,
   post-merge-prd). _One shared "idempotent comment" helper (marker-check before create) fixes all._
2. **Cold re-run recreates existing git branches/worktrees** → hard failures or corruption (tdd,
   goal-run, to-prd CREATE). _Needs graceful reconcile, not a raw git error._

Plus: REVIEW.md / AC-description overwrites lose human edits and conductor `resolved` markers;
`goal-prep --force` wipes resume state.

---

## 6. Contradictions & doc-lies — [C] (Theme G targets)

1. **`tdd` non-idempotency** is in Invariants but missing from "Known gaps."
2. **Doc claims post-merge "refreshes RISOLUTO_FEATURES.md"** (diagram + walkthrough + Surfaces
   table) — the script only **prints "ACTION REQUIRED: run /risoluto-features."** It's manual, not CI.
3. **Doc claims a 4-field slug-consistency check "enforces this post-merge"** — **no such code
   exists.** (HIGH — silent join-key breakage.)
4. **`pre-pr` is "advisory/not blocking"** yet its inner `/v1-check` is "MANDATORY/non-negotiable" —
   two blocking levels blurred; in the AFK path the conductor's gate already runs `/v1-check`, so
   running pre-pr too re-runs it with no "which wins" rule.
5. **`to-prd` uses direct Linear GraphQL; `to-issues` uses Linear MCP** — adjacent skills, incompatible
   access patterns, no stated reason (agent-porting inconsistency).
6. **Doc presents post-merge issue-status/AC reconcile as automated** — it is not (see §3).

---

## 7. AFK completion-guarantee analysis — [C] conductor.workflow.mjs

The cascade is `for (wave of waves) { … if (!merged) break }`. Concretely:

- **Stuck issue → cascade halt.** A persistently-failing build → `green=[]` → merge order `(none)` →
  `mergedIds=[]` → `blockedWave=true` → `break`. No skip-and-continue, no retry/back-off, no
  "come back later." A transient Linear/git blip permanently stalls the run. (HIGH)
- **Gate-null breaks silently.** A null setup/gate agent return (budget/context exhaustion) breaks the
  `for` loop **without** calling the blocker-recording agent (that's only inside the `blockedWave`
  branch). Operator sees "N/total waves merged" with **no PLAN.md blocker** and integration possibly
  in a partial state. (HIGH — hardest to diagnose on resume.)
- **No budget logic in the script.** "Budget exhaustion is a hard stop" is SKILL.md prose only; the
  conductor has no budget check or per-agent timeout.
- **No new-test guard.** `BUILD_SCHEMA` has no `testsAdded`; the wave gate passes on pre-existing
  tests. The "tests-pass-but-none-added" regression is caught only by `/risoluto-tdd` prose +
  review-handoff lens — both model judgment. (HIGH — the exact named regression.)
- **No reachability guard.** Zero `rg`/grep for non-test callers in the conductor; a wave goes green
  over dead production code. (HIGH — overlaps `verification-ladder`.)
- **Partial-wave merge leaves integration mixed** — green issue branches merge into the wave branch,
  but if the gate then fails/`break`s, the wave never merges to integration; future waves branch from
  this in-between tip. (HIGH)
- **Orphaned discovered issues** — `tdd` Step 4.5 files mid-build `discovered` issues (RIS-222);
  `WAVES.md` is frozen, so the conductor can never build them. "Finish ALL issues" is impossible for
  anything found mid-run.
- **CONTROL.md pause only honored at next wave boundary**, not mid-wave round. (low)

**Answer to "does goal-prep interview roadblockers?"** [C] **No.** Step 3 "runner readiness" is a
status print (clean tree, `LINEAR_API_KEY` set, skills present). There is no interactive
`AskUserQuestion` pre-flight clearing missing env/secrets, non-falsifiable ACs, unresolved blocked-by,
or scope ambiguity. The Theme A gap is real.

---

## 8. Deconfliction — what `verification-ladder` already owns [C]

9 Linear issues, all `Backlog`, 4 waves:

| Wave          | Issues                                                                                      | Owns                                      |
| ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1 Static gate | RIS-225 manifest+loader, RIS-227 analyzer, RIS-229 `reach:check` (madge/knip)               | reachability determinism                  |
| 2 E2E tier    | RIS-226 harness+CLI e2e, RIS-228 HTTP e2e, RIS-230 Slack e2e                                | behavioural reachability / test mid-tiers |
| 3 Enforcement | RIS-231 wire into v1 gate+CI, **RIS-232 in-loop DoD edits to tdd/to-issues/review-handoff** | external + in-loop enforcement            |
| 4 Capstone    | RIS-233 seed manifest, prove the ladder bites, doc live rung                                | retroactive audit                         |

**Implication:** Themes **B (reachability), D (cross-model reachability confirm), E (test pyramid)**
are substantially **owned by `verification-ladder`.** This session should **not** build them; where a
theme overlaps, align to the manifest+`reach:check`+e2e design and to RIS-232's DoD edits.

---

## 9. Theme → gap map (what's new this session vs deferred)

| Theme                                            | Gap (confirmed)                                                                                              | This session?                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **A** roadblocker interview                      | goal-prep readiness is a status print, not an interview                                                      | **NEW** — interactive pre-flight                                |
| **A** completion guarantee                       | halt-on-stuck, gate-null silent PLAN.md loss, no budget logic, orphaned discovered issues                    | **NEW** — conductor hardening                                   |
| **B** determinism hooks                          | `gh pr create`/`v1-check` gate, slug-consistency, new-test guard, SessionStart invariants — all prose        | **NEW** — hooks (complements, doesn't dup, verification-ladder) |
| **B/D/E** reachability + test pyramid            | proven regression                                                                                            | **DEFER to `verification-ladder`** (align only)                 |
| **C** tdd/simplify/review placement              | Done-owner contradiction; pre-pr advisory-vs-mandatory blur; AFK skips pre-pr                                | **NEW** — make state machine explicit + observable              |
| **D** per-issue cross-model AC verify (opencode) | review-handoff is goal-level only                                                                            | **NEW** — distinct from review-handoff; opencode                |
| **F** Linear memory layer                        | no deterministic issue-Done; commentCreate dups; premature post-merge flip; per-skill r/w contract undefined | **NEW** — sync + contract + base-branch guard                   |
| **G** whole-pipeline harmony                     | 6 contradictions/doc-lies; missing slug check; systemic idempotency                                          | **NEW** — fix + doc as current truth                            |
| **H** skill portfolio                            | goal-prep⊂goal-run overlap; gaps want new skills (preflight, sync, verify)                                   | **NEW** — merge/keep + fill (no flag/mode)                      |

---

## 10. Sources

Discovery workflow `wf_b0b381e6-76b` (22 agents, 1.35M tokens) → full output in session tasks dir.
Main-loop reads: `skills/risoluto-{to-prd,to-issues,tdd,pre-pr,goal-prep,goal-run,review-handoff}/SKILL.md`,
`skills/risoluto-goal-run/references/conductor.workflow.mjs`, `.claude/settings.json`,
`.husky/{pre-commit,pre-push,post-merge}`, `.github/workflows/post-merge.yml`,
`scripts/post-merge-prd.mjs`, `docs/research-to-shipping-pipeline.md`, `docs/prds/verification-ladder.md`,
`docs/roadmap.md`, Linear RIS (`workflow-first-afk-mvp`, `verification-ladder` projects).
