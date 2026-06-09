---
slug: code-review-remediation
linear_project: https://linear.app/ninetech/project/code-review-remediation-7d80b2af1c4e
synced_at: 2026-06-03T16:18:14.818Z
source: docs/roadmap.md#code-review-remediation
status: shipped
---

## Problem Statement

A whole-project deep review of Risoluto — conducted slice by slice by independent
deep-review agents reading the actual source across all 33 modules in `src/`
(about 47k LOC) — produced `CODE-REVIEW-FINDINGS.md`: **88 distinct findings** (2 Critical,
around 35 High, around 40 Medium, around 11 Low). These are not style nits. They are latent security
and reliability defects in _shipped_ surface that sits underneath every AFK Workflow
Run: the agent/codex approval gate, the secrets store, the persistence layer, the
orchestrator lifecycle, the webhook intake path, and the git/docker/workspace
sandbox boundary.

The dominant risk is that Risoluto runs untrusted-model output against real
repositories with real credentials, AFK. Two findings let a compromised prompt or
model perform privileged actions with no operator gate (`acceptForSession` for
command/file/permission requests). A cross-cutting theme of secret leakage means
tokens and master keys can escape via logs, SSE streams, alert payloads, audit
rows, webhook error bodies, and HTTP config endpoints. Another theme — non-atomic
read-modify-write and a `withRetry` that swallows the final error and reports
success — means the system can silently corrupt or lose run/persistence state and
_believe it succeeded_.

Fixing these now hardens the AFK core before more surface layers on top. Every
finding in `CODE-REVIEW-FINDINGS.md` carries a precise file:line anchor and a
proposed fix; this PRD turns that review into shippable, independently-verifiable
remediation work. The review document is the canonical evidence base — each user
story below maps to one or more findings in it.

## Solution

Remediate every finding in `CODE-REVIEW-FINDINGS.md`, sequenced Critical → High →
Medium → Low, grouped by the ten cross-cutting themes so related fixes land
together and share regression tests. The work is organised into themed slices,
each shippable on its own with a red test that proves the defect, then the fix that
turns it green:

1. **Privilege gating** — replace blanket `acceptForSession` auto-approval (agent +
   codex control plane) with deny-by-default routed through an auditable operator/policy gate.
2. **Secret-leakage closure** — harden `content-sanitizer` (assignment keys, auth
   headers, non-plain containers) and route every logging / emit / persist / Slack /
   webhook / alert / audit path through redaction.
3. **HTTP secret exposure** — sanitize the config-overlay response, stop echoing the
   master key, protect `/metrics`, and add the missing Slack URL-encoded body parser.
4. **Atomicity & transactions** — wrap multi-step persistence migrations and
   read-modify-write paths in transactions / CAS, and make workflow-run archive,
   intake idempotency, and webhook-inbox claims atomic.
5. **Injection & path traversal** — validate git refs, repo URLs, docker image refs,
   and the codex command argv; stop deriving docker mounts from workspace-controlled
   `.git` pointers; reject empty workspace keys and symlinked workspace dirs.
6. **SSRF** — allowlist GitHub/provider hosts before sending tokens (git-context
   enrichment, setup provider validation).
7. **Webhook hardening** — dedupe on verified-body digest (not unsigned delivery IDs),
   and persist durable processing state before acking.
8. **`withRetry` blast radius** — rethrow the final error by default; split off an
   explicit non-fatal variant only where failure is genuinely ignorable.
9. **Prototype-pollution closure** — filter dangerous keys in config `deepMerge`.
10. **Resource-leak closure** — orchestrator listeners/subscriptions, docker-session
    timers/volumes, automation scheduler, and unbounded in-memory maps.

The PRD's acceptance bar is behavioural: each finding gets a test that fails on the
current code and passes after the fix. No finding is "done" because the code reads
better — only because a named check proves the defect is gone.

## User Stories

> Each story names a verifiable behaviour and cites its finding(s) in
> `CODE-REVIEW-FINDINGS.md` by `file:line`. The global merge gate
> (build / lint / format / test / typecheck / coverage) is assumed on every slice and
> is not restated per story.

### Critical

1. As a Risoluto operator, I want command/file/permission approval requests from the
   agent to be denied by default (or gated through an explicit operator/policy
   decision), so that a compromised prompt cannot turn an approval-gated action into
   unattended execution for the whole session. _(`src/agent/codex-request-handler.ts:164`)_
2. As a Risoluto operator, I want host-side Codex approval requests (command/file/
   permission) routed through the same auditable gate rather than auto-accepted for
   the session. _(`src/codex/control-plane.ts:332`)_
3. As a Risoluto operator, I want `launchWorker` to re-check the running flag inside
   the lock before registering and before `runAttempt`, so that a worker started
   during `Orchestrator.stop()` cannot survive as an orphan after shutdown.
   _(`src/orchestrator/worker-launcher.ts:475`)_

### High — privilege & secret leakage

4. As an operator, I want all Codex notification params emitted as an allowlisted,
   redacted projection, so prompt text / tool args / account metadata / secrets never
   hit the event bus raw. _(`src/codex/control-plane.ts:360`)_
5. As a read-token holder, I want `GET/PUT/PATCH /api/v1/config/overlay` to sanitize
   every value, so the overlay never leaks `apiKey`/`githubSecret`/tokens/webhooks.
   _(`src/http/routes/config.ts:89`)_
6. As an operator, I want `POST /api/v1/setup/master-key` to return `204`/`{ok:true}`
   and never echo the submitted master key. _(`src/http/routes/setup.ts:42`,
   `src/setup/setup-service.ts:240`)_
7. As an operator, I want live agent/command streaming to pass `buffer.content`
   through `sanitizeContent` before every emit, so secrets don't leak over SSE / logs
   / event storage. _(`src/agent-runner/notification-handler.ts:60`)_
8. As an operator, I want JSON-RPC notification params and stderr redacted (or reduced
   to method names + bounded diagnostics) before logging. _(`src/agent/json-rpc-connection.ts:190`)_
9. As an operator, I want raw-text assignment redaction to recognise `SLACK_SIGNING_SECRET=`,
   `OPENAI_API_KEY=`, `GITHUB_TOKEN=` etc. via boundary-aware key matching against the
   full `REDACT_KEYS` set. _(`src/core/content-sanitizer.ts:324`)_
10. As an operator, I want authorization/password assignment redaction to consume the
    full credential segment, so `Authorization: Basic <token>` is fully redacted.
    _(`src/core/content-sanitizer.ts:348`)_
11. As an operator, I want `redactSensitiveValue` to handle `Map`/`Set`/`Headers`/
    `URLSearchParams`/`Error` containers so embedded secrets are redacted, not retained.
    _(`src/core/content-sanitizer.ts:417`)_
12. As an operator, I want `captureException` to redact message / stack / breadcrumbs /
    contexts before persistence. _(`src/core/error-tracking.ts:52`)_
13. As an operator, I want alert notifications to embed an allowlisted, redacted
    per-event summary instead of the entire raw event payload. _(`src/alerts/alert-pipeline.ts:135`)_
14. As an operator, I want audit log redaction applied by key/path/value policy to all
    config mutations, not only when `tableName === "secrets"`. _(`src/audit/logger.ts:81`)_
15. As an operator, I want failed webhook-delivery errors to log only status + a short
    redacted diagnostic, never the full upstream body. _(`src/notification/webhook-delivery.ts:35`)_
16. As an operator, I want the Linear `linear_graphql` agent tool restricted to an
    allowlisted read-only operation set, rejecting `mutation`/`subscription` and
    secret-bearing fields. _(`src/linear/graphql-tool.ts:42`)_

### High — injection, traversal & SSRF

17. As an operator, I want docker mounts derived only from the known `gitBaseDir`, never
    from workspace-controlled `.git`/`gitdir`/`commondir` contents, so a workspace cannot
    mount arbitrary host directories into the container. _(`src/docker/workspace-mounts.ts:31`)_
18. As an operator, I want docker image refs validated (reject leading `-`, insert an
    option terminator) so an image string cannot become a docker flag. _(`src/docker/spawn.ts:220`)_
19. As an operator, I want empty sanitized workspace keys rejected and
    `workspacePath === workspaceRoot` refused, so workspace removal can never delete the root.
    _(`src/workspace/paths.ts:36`, `src/workspace/manager.ts:255`)_
20. As an operator, I want existing workspace dirs validated with `lstat()` + `realpath()`
    and symlinks/out-of-root paths rejected. _(`src/workspace/manager.ts:147`)_
21. As an operator, I want the codex command passed as validated argv to the docker
    entrypoint, not a shell-interpolated string. _(`src/agent-runner/docker-session.ts:95`)_
22. As an operator, I want `git clone` called with a validated URL scheme and a `--`
    terminator, so a repo URL beginning with `-` cannot be parsed as an option.
    _(`src/git/worktree-manager.ts:71`)_
23. As an operator, I want branch names validated via `git check-ref-format --branch`
    before checkout/worktree/push. _(`src/git/manager.ts:47`)_
24. As an operator, I want GitHub enrichment to allowlist GitHub/approved-enterprise
    hosts before sending the token to `config.github.apiBaseUrl`. _(`src/http/git-context.ts:226`)_
25. As an operator, I want setup provider validation to parse the URL, require `https`,
    and block loopback/private/link-local hosts before sending the API key.
    _(`src/setup/setup-service.ts:85`)_

### High — secrets store, config & crypto hygiene

26. As an operator, I want `activeMasterKey` assigned only after the existing archive
    decrypts, and cleared on every failure path, so a wrong-key start cannot later
    overwrite the real `secrets.enc`. _(`src/secrets/store.ts:143`)_
27. As an operator, I want the whole `set()` mutation serialized and `requiredMasterKey()`
    checked before mutating the plaintext cache. _(`src/secrets/store.ts:231`)_
28. As an operator, I want `DbSecretsStore.start()` to prove existing rows decrypt and
    fail on mismatch, so a wrong key doesn't masquerade as "missing secrets."
    _(`src/secrets/db-store.ts:68`)_
29. As an operator, I want the master-key file written only after `initializeWithKey()`
    succeeds, with temp-file rollback on failure. _(`src/setup/setup-service.ts:235`)_
30. As an operator, I want `secrets.enc` written `0o600` and fsynced (file + dir) around
    the atomic rename. _(`src/secrets/store.ts:306`)_
31. As an operator, I want refreshed Codex tokens to `chmod` an existing permissive
    `auth.json` to `0o600` (or temp-file + atomic rename+chmod). _(`src/codex/token-refresh.ts:192`)_
32. As an operator, I want config `deepMerge()` to recursively reject
    `__proto__`/`constructor`/`prototype` keys, so loaded YAML/DB config cannot pollute
    the prototype. _(`src/config/merge.ts:27`)_
33. As an operator, I want DB config mutations to derive/validate a candidate before
    commit (or roll back write+refresh together), so a bad overlay can't persist when
    `refresh()` throws. _(`src/config/db-store.ts:138`)_

### High — reliability core

34. As a developer, I want `withRetry` to rethrow the final error by default (with an
    explicit `withNonFatalRetry` for ignorable callers), so failed mutations stop
    reporting success. _(`src/utils/retry.ts:26`)_
35. As an operator, I want the orchestrator startup recovery wrapped so a throw resets
    `running=false`, stops the watchdog, and rethrows — no half-started instance.
    _(`src/orchestrator/orchestrator.ts:123`)_
36. As an operator, I want `stop()` to bound its worker wait with a shutdown timeout and
    force cleanup, so one abort-ignoring worker can't hang shutdown forever.
    _(`src/orchestrator/orchestrator.ts:180`)_
37. As an operator, I want `workerPromise.finally(...)` to always resolve `entry.promise`
    even when outcome/failure handling throws (no unhandled rejection).
    _(`src/orchestrator/worker-launcher.ts:548`)_
38. As an operator, I want one idempotent docker-session cleanup path that always clears
    the stats interval and removes container + cache volume, even after an abort.
    _(`src/agent-runner/docker-session.ts:180`)_
39. As an operator, I want the docker CLI child to inherit only a whitelisted env, with
    provider secrets injected explicitly. _(`src/agent-runner/docker-session.ts:139`)_
40. As an operator, I want signal exits (non-null `signal`) classified as failure unless
    the run was intentionally aborted. _(`src/agent-runner/exit-classifier.ts:20`)_
41. As an operator, I want `maxTurns` exhaustion to return an explicit
    `max_turns_exceeded` failed/blocked outcome, not `null` that reads as "normal."
    _(`src/agent-runner/turn-executor.ts:261`)_
42. As an operator, I want duplicate active dispatch `runId`s rejected (409) or keyed by
    `(runId, attempt)`, so the first run stays abortable. _(`src/dispatch/server.ts:89`)_
43. As an operator, I want the dispatch SSE request to abort the attempt on client
    disconnect (`req/res "close"`), so a disconnect doesn't leave the agent running.
    _(`src/dispatch/server.ts:92`)_
44. As an operator, I want remote dispatch to require TLS/mTLS (or private transport) and
    avoid serializing secret-bearing `ServiceConfig`/auth into the request body.
    _(`src/dispatch/client.ts:106`, `factory.ts:43`)_

### High — persistence & workflow-run integrity

45. As an operator, I want `safeReaddir` to return `[]` only for `ENOENT` and hard-fail on
    permission/I/O errors, writing the JSONL-migration flag only after a verified scan.
    _(`src/persistence/sqlite/migrator.ts:162`)_
46. As an operator, I want the v6 `pull_requests` rebuild/copy/drop/rename wrapped in one
    transaction. _(`src/persistence/sqlite/database.ts:432`)_
47. As an operator, I want webhook-inbox due retries atomically claimed
    (`UPDATE ... WHERE status='retry' ... RETURNING`), so two workers can't process the
    same delivery. _(`src/persistence/sqlite/webhook-inbox.ts:183`)_
48. As an operator, I want an empty CI check list treated as `blocked`/`pending` with
    explicit "no checks observed" evidence, never as "all CI passed."
    _(`src/workflow-run/ci-babysitter.ts:77`)_
49. As an operator, I want PR publish to happen before a run is marked terminal `done`
    (or a publish failure to move the run to `blocked` with a handoff), so a publish
    failure can't strand a `done` run with no PR. _(`src/workflow-run/drive-accepted-run.ts:109`)_
50. As an operator, I want action dedupe scoped by attempt/state/phase so verifier-driven
    retries actually re-run `run-validation-profile` instead of reusing stale validation.
    _(`src/workflow-run/executor-actions.ts:26`)_
51. As an operator, I want intake to create the run record and idempotency mapping
    atomically (pending→committed with recovery), so a crash mid-claim can't poison
    future duplicate intake. _(`src/workflow-run/intake-core.ts:144`)_
52. As an operator, I want run status updates to enforce valid transitions under per-run
    lock/CAS and refuse writes from terminal states, so a concurrent cancel isn't
    overwritten by `done`/`blocked`. _(`src/workflow-run/archive.ts:221`)_
53. As an operator, I want GitHub webhook replay protection to dedupe on a digest of the
    verified raw body + signature, not just the unsigned `X-GitHub-Delivery`.
    _(`src/webhook/github-handler.ts:79`)_
54. As an operator, I want webhook handlers to persist durable processing state
    (retry/DLQ) before returning 200, so an early ack can't drop a delivery whose side
    effects later fail. _(`src/webhook/delivery-workflow.ts:74`)_

### High — HTTP transport

55. As an operator, I want a URL-encoded/raw-body parser on `/webhooks/slack` so valid
    `application/x-www-form-urlencoded` Slack interactive requests get a `rawBody` for
    signature handling. _(`src/http/server.ts:95`)_

### Medium

56. As a developer, I want `withRetry` to validate `maxAttempts` as a positive safe
    integer and cap exponential backoff. _(`src/utils/retry.ts:20`, `:33`)_
57. As an operator, I want workflow-run attempt numbers/sequence assigned atomically and
    blocked-handoff memory/evidence threaded through, with per-`questionId` Slack
    response exclusivity and redacted hook evidence. _(`src/workflow-run/drive-accepted-run.ts:266`,
    `intake-core.ts:232`, `archive.ts:147`, `verifier.ts:140`, `drive-accepted-run.ts:192`,
    `slack-interactions.ts:109`, `executor-event-log.ts:43`)_
58. As an operator, I want HTTP hardening: write-token required for mutations (no bare
    loopback bypass when proxied), rate-limit keyed by IP+route, `/metrics` protected,
    body-parser parse errors → 400, unexpected `TypeError` → 500, query-token only for
    SSE, and clamped pagination limits. _(`src/http/write-guard.ts:96`, `routes/webhooks.ts:45`,
    `routes/system.ts:87`, `service-errors.ts:54`, `service-errors.ts:37`, `read-guard.ts:114`,
    `query-params.ts:4`, `routes/codex.ts:17`, `routes/codex.ts:40`, `dep-validator.ts:41`)_
59. As an operator, I want persistence correctness: patch-only attempt updates, the
    `attempt_checkpoints` foreign key, full-field checkpoint dedupe, transactional template
    seeding, orphan-event skipping, and DB-handle close on init/open failure.
    _(`src/persistence/sqlite/attempt-store-sqlite.ts:79`, `database.ts:155`,
    `attempt-store-sqlite.ts:137`, `runtime.ts:71`, `migrator.ts:112`, `runtime.ts:107`,
    `database.ts:587`)_
60. As an operator, I want orchestrator robustness: orphaned running issues aborted, all
    running attempts recovered, per-container cleanup continuing on failure, tracker
    refresh distinguishing transient failure, and coalesced retry notifications.
    _(`src/orchestrator/lifecycle.ts:23`, `recovery.ts:36`, `recovery.ts:173`,
    `worker-outcome/prepare.ts:16`, `retry-coordinator.ts:217`)_
61. As an operator, I want agent-runner/dispatch fixes: immediate reject on already-aborted
    signal, shutdown errors not overriding outcome, and `removeVolume` failures
    non-fatal. _(`src/agent-runner/turn-state.ts:143`, `attempt-executor.ts:214`,
    `docker-session.ts:226`)_
62. As an operator, I want config/secrets hardening: subscribe to secret rotation, reject
    corrupt persisted JSON (keep last-known-good), validate derived sections through Zod,
    validate `server.port` is between 1 and 65535, debounce overlay `unlink`, and isolate store
    listeners. _(`src/config/db-store.ts:101`, `db-store.ts:40`, `derivation-pipeline.ts:78`,
    `section-builders.ts:257`, `overlay.ts:64`, `secrets/store.ts:256`, `config/validators.ts:42`)_
63. As an operator, I want setup hardening: validate `defaultBranch` as a git ref, generic
    error codes, transactional overlay+secret writes, start/probe before persisting slug,
    and distinct auth-failure surfacing. _(`src/setup/setup-service.ts:72`, `handlers/openai-key.ts:41`,
    `setup-service.ts:272`, `setup-service.ts:293`, `setup-service.ts:250`,
    `setup-service.ts:161`, `setup-service.ts:465`)_
64. As an operator, I want tracker/webhook integrity: body/signature-hash dedupe for
    Linear + Slack, required Linear inbox, paginated webhook listing without the `secret`
    field, strict create/update-webhook validation, PR filtering on GitHub issues, and
    correct label-state transitions. _(`src/webhook/linear-handler.ts:124`, `:133`,
    `slack-handler.ts:118`, `linear/queries.ts:232`, `:224`, `linear/client.ts:331`, `:310`,
    `github/issues-client.ts:173`, `tracker/github-adapter.ts:65`, `:37`)_
65. As an operator, I want git/workspace/docker robustness: per-repo clone locks with
    atomic rename, remote-branch-aware worktrees, lock-inside public lifecycle methods,
    `git worktree prune` on fallback removal, and drained hook stdout.
    _(`src/git/worktree-manager.ts:63`, `:129`, `src/workspace/manager.ts:93`, `:305`, `:351`)_
66. As an operator, I want codex/prompt hardening: user-origin template fields fenced/
    escaped, template body re-validated on resolution, sensitive literal header/query
    names rejected, token-refresh response schema-validated, and model-list failures
    surfaced not swallowed. _(`src/prompt/template-policy.ts:4`, `resolver.ts:48`,
    `codex/runtime-config.ts:116`, `token-refresh.ts:182`, `model-list.ts:57`)_
67. As an operator, I want core utility correctness: isolated event-bus listeners with a
    snapshot before iteration, line-anchored stop-signal detection, validated token
    counts in cost math, and a total `tool-call-result` serializer.
    _(`src/core/event-bus.ts:58`, `signal-detection.ts:29`, `model-pricing.ts:43`,
    `utils/tool-call-result.ts:15`)_
68. As an operator, I want observability/notification/automation hardening: dedupe/
    cooldown set only after real success, channels reporting delivered|skipped, sanitized
    observability snapshots, escaped Prometheus labels, idempotent scheduler start, and
    per-check preflight/probe timeouts. _(`src/notification/manager.ts:65`, `:93`,
    `alerts/alert-pipeline.ts:51`, `observability/hub.ts:56`, `observability/metrics.ts:45`,
    `automation/scheduler.ts:52`, `health/probes/linear-probe.ts:39`, `live/preflight.ts:23`,
    `health/health-runner.ts:126`)_
69. As an operator, I want workflow-definition loading hardened: reject symlinks/non-regular
    files with a size cap, detect duplicate definition and state IDs, and require
    non-empty states/roles. _(`src/workflow-definition/registry.ts:136`, `:113`, `:92`, `:95`)_

### Low

70. As a developer, I want the residual Low-severity cleanups applied: richer intake/
    validation outputs, orchestrator listener/subscription/map cleanup, atomic
    idempotency-store writes, gate-retry budget looping, safe metadata parsing + clamped
    limits, GitHub rate-limit/422 handling, terminal-state polling, model-list cache
    keyed off non-secrets, CLI arg validation + concise top-level errors, epoch-based
    attempt sorting, hysteresis fix, automation finalize-before-notify, Slack mrkdwn
    escaping, audit hash-chain, role-graph cycle detection, and file-context'd registry
    errors. _(All Low findings in `CODE-REVIEW-FINDINGS.md`: `tracker-intake.ts:72`,
    `routes/workflow-runs.ts:73`, `orchestrator.ts:82`/`:85`, `lifecycle-state.ts:271`,
    `worker-launcher.ts:46`, `intake-idempotency-store.ts:106`, `gate-retry-controller.ts:62`,
    `mappers.ts:90`, `webhook-inbox.ts:246`, `issues-client.ts:141`/`:273`, `github-adapter.ts:37`,
    `model-list.ts:38`, `admin-service.ts:51`, `prompt/store.ts:22`, CLI commands,
    `index.ts:317`, `attempt-analytics.ts:5`, `health-runner.ts:156`, `automation/runner.ts:88`,
    `slack-webhook.ts:90`, `audit/logger.ts:86`, `registry.ts:185`/`:142`)_
71. As a maintainer, I want the spurious
    `[JSON PARSE ERROR — IMMEDIATE ACTION REQUIRED]` string tracked down and removed from
    wherever it leaks into agent output, so review/agent transcripts stop carrying
    injected noise. _(`CODE-REVIEW-FINDINGS.md` process note)_

## Implementation Decisions

- **Severity is the sequencing spine.** Critical first, then High, Medium, Low. Within
  a severity, group by the ten cross-cutting themes so shared helpers (redaction,
  transaction wrappers, ref/URL validators, the privilege gate) are written once and
  reused, not re-derived per file.
- **One shared redaction seam.** The `content-sanitizer` fixes (stories 9–11) land
  first within the secret-leakage theme; every downstream leak fix (7, 8, 12–15)
  routes through the hardened sanitizer rather than bespoke per-call redaction.
- **One privilege gate.** Stories 1, 2, and 4 share a single auditable approval/policy
  surface; the agent handler and codex control plane call into it rather than each
  re-implementing deny-by-default.
- **Validation helpers, not inline checks.** Git ref validation (`git check-ref-format`),
  URL/host allowlisting, docker image-ref validation, and workspace-key validation each
  become a small reusable validator with its own unit tests, consumed by stories 17–25
  and the Medium git/workspace slice.
- **Transactions at the seam.** Persistence atomicity (stories 45–47, 52, 59) uses
  better-sqlite3 transactions / `UPDATE ... RETURNING` CAS rather than application-level
  locks where the DB can enforce it.
- **No behaviour change beyond the finding.** Each fix is the minimum that turns its red
  test green. No opportunistic refactors, no new config surface, no backwards-compat
  shims — the review proposes targeted fixes and this PRD honours that scope.
- **The findings doc is the contract.** `CODE-REVIEW-FINDINGS.md` stays in-tree as the
  traceability map; `/risoluto-to-issues` slices these stories into tickets that each
  cite their file:line anchor.

## Testing Decisions

- **Red-first, per finding.** Every story ships with a test that fails on current code
  (proving the defect) and passes after the fix. For security findings the test asserts
  the _attack is refused_ (e.g. a `-`-leading repo URL is rejected; a workspace `.git`
  pointer to `/home` does not produce a host mount; the master-key response body
  contains no key material).
- **Leakage tests assert absence.** Secret-leakage fixes assert the secret value never
  appears in the emitted/logged/persisted artifact, using a sentinel token planted in
  the input.
- **Atomicity tests simulate the crash/race.** Migration and read-modify-write fixes are
  tested by injecting a failure between steps (or concurrent writers) and asserting the
  invariant holds (no partial table, no duplicate sequence, no double-processed delivery).
- **Privilege tests assert the gate.** The auto-approval fixes assert that an approval
  request is denied/deferred to policy by default and only proceeds through the explicit
  gate.
- **Behaviour, not implementation.** Tests target the external contract (HTTP response
  shape, emitted event fields, persisted row state, process exit classification), not
  private helper internals, so the fixes can be refactored without churning tests.
- **Reuse existing test shapes.** Mirror the prior-art integration tests already in
  `tests/` (e.g. the setup-API integration test that currently locks the master-key
  echo must be updated to assert key _absence_).

## Out of Scope

- **No new product features.** This is remediation only; nothing here adds operator-facing
  capability beyond closing the findings.
- **No architectural rewrites.** Module boundaries stay as-is; fixes are local to the
  cited seams. Larger refactors (e.g. replacing the dispatch transport entirely) are
  out of scope beyond the specific hardening each finding names.
- **No new findings discovery.** This PRD remediates the 88 findings already in
  `CODE-REVIEW-FINDINGS.md`; a fresh review pass is a separate roadmap row.
- **The loopback write-guard bypass** (`write-guard.ts:96`) is addressed as the review
  re-ranked it (Medium, documented intentional design) — hardened, not removed, unless
  the founder decides otherwise.
- **Audit hash-chain** (`audit/logger.ts:86`) is included as a Low cleanup; a full
  tamper-evident audit subsystem is a separate initiative if it grows beyond the
  append-only HMAC the finding proposes.

## Further Notes

- **Traceability.** Keep `CODE-REVIEW-FINDINGS.md` in-tree until every finding is closed;
  it is the authoritative checklist. As slices merge, the corresponding finding can be
  struck through or annotated with its PR.
- **Process-note follow-up.** Story 71 (the injected `[JSON PARSE ERROR ...]` string) is
  a small investigation that may surface a real bug in how agent tool output is
  assembled — worth doing early so later review passes aren't polluted.
- **Counting caveat.** The review's totals are approximate ("around 35 High", "around 40 Medium").
  `/risoluto-to-issues` should treat the file:line anchors as the definitive finding
  list, not the headline counts.
- **Re-verification.** A few findings were re-ranked on oracle re-verify (e.g. the
  loopback bypass High→Medium); trust the per-finding text over the cross-cutting
  summary where they differ.
