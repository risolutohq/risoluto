# Planning Pipeline Workflow

> How to drive `planning-pipeline-roadmap.md` to completion across many sessions.
> Two roles: **build** produces artifacts, **review** verifies and ticks checkboxes.
> Both prompts are self-contained — paste at session start and the agent picks up where the roadmap left off.

## Why two roles

- **Build sessions stay scoped.** Pick the first `- [ ]` subtask, build it, commit. No roadmap edits — keeps the build agent focused on code, not bookkeeping.
- **Review sessions have fresh eyes.** They verify each subtask against its smoke criterion and the phase's exit criterion, then tick the boxes. Catches scope creep and exit-criterion drift that a build session might rationalize past.
- **The roadmap stays trustworthy.** Only the review session writes `- [x]`, so the checked state of any subtask reflects what was actually verified.

Build and review can alternate session-by-session, or run in parallel (build in one terminal, review in another).

## Build prompt

Paste at the start of every build session.

```text
Continue the Risoluto planning pipeline roadmap. Build the next
pending subtask.

Read:
1. docs/planning-pipeline-roadmap.md — first `- [ ]` subtask is the
   target.
2. Memory file project_planning_pipeline_bootstrap.md.
3. The roadmap's **Preflight** section (top). If any preflight item
   for this phase isn't met, surface the gap before building.

Skill subtasks — MANDATORY:
- If the subtask creates or modifies a skill (anything under
  `skills/risoluto-*/` or `~/.claude/skills/`), you MUST invoke the
  `/skill-creator` skill. It scaffolds SKILL.md frontmatter, the
  folder layout, and benchmarks the description's triggering
  accuracy via its eval workflow.
- Do NOT hand-write SKILL.md or the skill folder structure, even if
  it looks simple. The skill convention has invariants `/skill-creator`
  enforces (frontmatter shape, description heuristics, eval scaffolding)
  that ad-hoc creation will miss.
- After first draft, use `/skill-creator`'s benchmarking to tighten
  the description until triggers fire reliably.

Build the subtask:
- Stay scoped to that one subtask. Don't touch other phases.
- AGENTS.md rules: Node 22+, pnpm 11, ESLint ceilings (max-lines 300,
  complexity 15, max-lines-per-function 50), Prettier 120-col + double
  quotes.
- Run the **Smoke** criterion (if listed) to prove the subtask works.
- Run the verification gate before claiming done:
    pnpm run build && pnpm run lint && pnpm run format:check \
      && pnpm test && pnpm run typecheck
  (In Claude Code, the `/v1-check` skill runs the same sequence.)
- Commit with a Conventional Commit subject naming the subtask,
  e.g. `feat: add risoluto-vault skill (Phase 1.2)`.

Don't:
- Tick roadmap checkboxes — that's the review session's job.
- Touch other phases.
- Skip hooks. Don't `--no-verify`.

When the subtask is built + verified:
- Report what landed (paths + commit sha).
- Ask: continue with the next subtask in this phase, or stop here
  for review?
```

## Review prompt

Paste at the start of every review session.

```text
Review the latest phase work on Risoluto's planning pipeline.

Read in order:
1. docs/planning-pipeline-roadmap.md — find the first phase with new
   commits against it but `- [ ]` checkboxes still unchecked.
2. Memory file project_planning_pipeline_bootstrap.md for prior state.
3. git log --oneline -20 + git --no-pager diff HEAD~N..HEAD for the
   new work (N = how many commits the build session landed).

Verify each subtask claimed done:
- Does the artifact exist at the documented path?
- Does the subtask's **Smoke** criterion (if listed in the roadmap)
  hold? Smoke criteria are English descriptions — interpret them, run
  the implicit test (e.g. invoke the new skill with a sample input,
  check the output, run validate:research).
- Does the verification gate pass?
    pnpm run build && pnpm run lint && pnpm run format:check \
      && pnpm test && pnpm run typecheck
  (Or the `/v1-check` skill in Claude Code.)
- If the subtask created or modified a skill, verify the skill follows
  `/skill-creator` conventions: SKILL.md has valid frontmatter (`name`,
  `description`), the description is specific enough to trigger
  reliably (skill-creator's eval workflow is the canonical benchmark),
  and the folder layout matches the skill convention. If it looks
  hand-rolled, flag the gap and ask the build session to re-run via
  `/skill-creator`.
- If all subtasks under a phase are done, does the phase's **Exit
  criterion** hold?

Report findings as a short table: subtask | pass/fail | evidence
(file path, command output, commit sha).

If all pass:
- Edit docs/planning-pipeline-roadmap.md: flip `- [ ]` to `- [x]`
  for every passing subtask.
- If a whole phase is done, append `_(completed YYYY-MM-DD, <sha>)_`
  next to the phase header (### Phase N).
- Commit with `docs: mark Phase X complete in planning-pipeline
  roadmap` (or `Phase X.Y` for partial). Body: one line per ticked
  subtask, what was verified.

If anything fails:
- Don't update the roadmap.
- Report each gap + a one-line proposed fix.
- Stop, wait for Omer's direction.

Constraints:
- No code writing in the review session — verify and report only.
- Don't skip hooks. Don't `--no-verify`.
- If memory's bootstrap state is stale (file paths changed, etc.),
  note it but proceed.
```

## Loop

```text
[Phase N build session]
   ↓ ships commits, no roadmap update
[Phase N review session]
   ↓ verifies, ticks boxes, commits roadmap update
[Phase N+1 build session]
   ↓ ...
```

When the roadmap has zero unchecked subtasks, the planning pipeline is built. The final review session writes the Phase 5 ADR and marks the roadmap superseded.
