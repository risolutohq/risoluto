---
name: risoluto-preflight
description: Interactive roadblocker interview before flipping a PRD into AFK/background build mode. Use when Omer says /risoluto-preflight, "preflight the goal", "is <slug> ready for a background build", "clear roadblockers before AFK", "can I let this run AFK", or before /risoluto-goal-prep + /risoluto-goal-run. After a PRD and its from:prd-<slug> Linear issues exist, this skill scans for the five things that strand an autonomous run — missing env/secrets, non-falsifiable acceptance criteria, unresolved blocked-by, missing test infra, scope conflicts (incl. discovered issues orphaned from the wave map) — then interviews the operator (AskUserQuestion) to dispose each one, and emits a GO / NO-GO readiness verdict. It does not render the goal package (that is /risoluto-goal-prep) and does not run the build. Read-mostly; the operator applies fixes through the owning skill.
---

# risoluto-preflight

The **roadblocker gate** before an autonomous build. `/risoluto-goal-prep`'s "runner readiness" is a
status print (clean tree, key exported, skills present) — it does not catch the things that strand an
AFK run mid-cascade. This skill does: it scans the PRD + its Linear issues for the five strand-classes,
interviews you to dispose each one, and only then says **GO**. Running it is how you consciously clear
the runway before handing the build to `/risoluto-goal-run` (or Codex `/goal`).

It is a pre-flight check, not a renderer and not a runner. It never edits `WAVES.md`, never renders the
package, never starts the cascade. It reports and interviews; you apply fixes through the owning skill.

> **Linear access (agent-portable).** Bind each Linear operation to your surface (Claude → MCP, Codex →
> `LINEAR_API_KEY` + GraphQL); concrete queries are in [`../references/linear-access.md`](../references/linear-access.md).
> Surface any Linear error verbatim and stop — never retry auth.

## Hard preconditions

| Check              | Verification                                  | If it fails                                        |
| ------------------ | --------------------------------------------- | -------------------------------------------------- |
| Run from repo root | `test -f package.json && test -f .gitmodules` | Tell Omer to `cd` into the Risoluto checkout root. |
| Slug provided      | argv has `<slug>`                             | Ask Omer for the PRD slug.                         |
| PRD exists         | `docs/prds/<slug>.md` exists                  | Run `/risoluto-to-prd <slug>` first.               |
| Issues exist       | `from:prd-<slug>` label returns ≥1 issue      | Run `/risoluto-to-issues <slug>` first.            |
| Linear reachable   | connectivity probe succeeds                   | Surface the error verbatim; do not retry auth.     |

## Pipeline

### Step 1 — Scan the five strand-classes (deterministic first)

Read the PRD and every `from:prd-<slug>` issue (status, `## Acceptance criteria`, blocked-by, labels,
`slice:afk`/`slice:hitl`), then collect findings — no questions yet:

1. **Env / secrets.** From the PRD's Implementation/Testing Decisions and the issue slices, list the
   env the run needs (`LINEAR_API_KEY`; `.env.live.local` for live slices; `SLACK_SIGNING_SECRET` /
   `SLACK_BOT_TOKEN` for Slack slices; GitHub/PR creds; `~/.codex/auth.json` for a live Codex dispatch).
   Probe presence (`[ -n "$VAR" ]`, `test -f`). Flag each **missing** one against the slice that needs it.
2. **Non-falsifiable acceptance criteria.** For each issue, flag any `## Acceptance criteria` line that
   is not a falsifiable behavioural assertion — a restatement of the global gate (build/lint/test/
   typecheck/coverage), a vague "works"/"is correct", or an empty list. These cannot become a red test,
   so the slice is not ready to start (the `acceptance-is-the-red-test` invariant).
3. **Unresolved blocked-by.** Flag any issue blocked-by a ticket that is not `Done` and is **not** a
   sibling in this PRD's wave set (an external or cross-PRD blocker the cascade cannot satisfy itself).
4. **Test infra.** Confirm the tiers the slices need exist — the relevant `vitest.*.config.ts`, a
   capstone/e2e for the dogfood slice, and `.env.live.local` for any `live` slice. Flag gaps.
5. **Scope.** Flag issue ACs that require something the PRD's **Out of Scope** excludes, and any
   `discovered`-labelled issue **orphaned from the wave map** (present in Linear but absent from
   `~/.risoluto/goals/<slug>/WAVES.md`, if a package exists) — these can never be built by the cascade.

### Step 2 — Interview to dispose each roadblocker

For the findings that need a decision, interview the operator. **Under Claude, use `AskUserQuestion`**
(one question per roadblocker class, options as the realistic dispositions); other agents stop and ask
explicitly. Typical dispositions:

- _Missing secret_ → **provide it** (then re-probe), **mark the slice deferred** (drop it from this run),
  or **proceed hermetic** (the run will honest-block at that boundary — acceptable for a non-live run).
- _Non-falsifiable AC_ → **sharpen** (operator dictates the assertion; apply it via `/risoluto-to-issues`
  reconcile or by editing the issue), **defer the slice**, or **accept as HITL** (not AFK-eligible).
- _Unresolved blocked-by_ → **wait** (block the run), **drop the edge** if wrong, or **reassign**.
- _Missing test infra_ → **add it first**, or **defer the slice**.
- _Scope conflict / orphaned discovered issue_ → **re-run `/risoluto-goal-prep`** to re-freeze the wave
  map (folds orphaned issues in), **defer**, or **raise the Out-of-Scope conflict** with the founder.

Apply nothing silently — each fix is the operator's call, applied through the owning skill.

### Step 3 — Emit the GO / NO-GO verdict

```
preflight: <slug>  AFK issues: <N>  cleared: <C>  outstanding: <O>
VERDICT: GO            → next: /risoluto-goal-prep <slug>  then  /risoluto-goal-run <slug>
  (or)
VERDICT: NO-GO         → outstanding roadblockers:
  - NIN-209  missing SLACK_SIGNING_SECRET (slice:afk) — provide or defer before launch
  - NIN-212  AC 3/4 non-falsifiable — sharpen via /risoluto-to-issues reconcile
  - NIN-222  discovered, orphaned from WAVES.md — re-run /risoluto-goal-prep
```

GO only when every outstanding roadblocker is cleared or consciously deferred. A deferred slice is named
so the operator knows the run will not cover it.

## Invariants & notes

- **Gate, not renderer, not runner.** Sits between `/risoluto-to-issues` and `/risoluto-goal-prep`. It
  never renders the package and never starts the cascade.
- **Read-mostly.** It reads Linear + git + env and reports; it does not edit issues, ACs, or `WAVES.md`.
  Fixes are applied by the owning skill (`/risoluto-to-issues` reconcile, `/risoluto-goal-prep`, etc.).
- **Skills propose; the founder disposes.** Every roadblocker disposition is the operator's explicit
  choice in the interview — nothing is auto-resolved.
- **Idempotent.** Re-running re-scans live state; a second run after fixes shows fewer roadblockers.
- **Default the team to `Ninetech`.** Only one team exists; do not ask.

## Companion files

- `../references/linear-access.md` — concrete Linear operations.
- `skills/risoluto-to-issues/` — owns AC sharpening (reconcile) and the slice graph.
- `skills/risoluto-goal-prep/` — the next step on GO; re-freezes `WAVES.md` (folds orphaned issues in).
- `skills/risoluto-goal-run/` — the AFK conductor this gate clears the runway for.
- `docs/research-to-shipping-pipeline.md` — the back-half pipeline this gate guards the entrance to.
