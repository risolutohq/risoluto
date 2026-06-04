# Risoluto — Whole-Project Code Review Findings

Full-project review across all 33 modules in `src/` (~47k LOC), conducted slice by slice by independent deep-review (oracle) agents. Review only — no code changes were made.

**Totals:** 1 Critical · ~33 High · ~41 Medium · ~13 Low

> Note: One issue (agent/codex auto-approval of privileged actions) is rated High by category but should be treated as Critical-severity security.

> **Re-verification (oracle, independent second pass):** Every finding was re-checked against live source. No false positives found and existence claims held up. Four adjustments were applied: `src/http/write-guard.ts:96` re-ranked **High→Medium** (documented intentional design); `src/workspace/paths.ts:36` re-ranked **High→Low** (no reachable caller); `src/utils/retry.ts:26` **re-framed** (bug is at the call sites, severity stays High); and the `state=open` finding's location corrected to **`src/github/issues-client.ts:173`** (was cited as `tracker/github-adapter.ts:37`). The three Criticals/security-critical cluster (codex auto-approval ×2, orphan worker, sandbox image injection, deepMerge prototype pollution) are confirmed airtight.

---

## Cross-cutting themes (highest leverage)

1. **Agents auto-approve privileged actions** — `acceptForSession` for command/file/permission requests (`src/agent/codex-request-handler.ts:164`, `src/codex/control-plane.ts:332`).
2. **Pervasive secret leakage** via raw logging/emit/persistence + gaps in `content-sanitizer`.
3. **Secrets exposed over HTTP** (master-key echo, unsanitized config overlay, loopback write bypass).
4. **Non-atomic read-modify-write / missing transactions** (persistence + workflow-run archive).
5. **Option/argument injection & path traversal** (docker, git, workspace).
6. **SSRF via configurable base URLs** (github enrichment, setup provider).
7. **Webhook replay + ack-before-process**.
8. **`withRetry` swallows final error** and reports success (wide blast radius).
9. **Prototype pollution** in config `deepMerge`.
10. **Resource leaks** (orchestrator listeners, docker-session timers, automation scheduler).

---

## Slice 1 — `src/workflow-run/`

### High

- **`src/workflow-run/ci-babysitter.ts:77`** — Empty CI check list falls through to `passedCiResult`, so a misconfigured/unavailable CI poller can fabricate "all CI checks passed." _Fix:_ treat `checks.length === 0` as `blocked`/`pending` with explicit evidence that no checks were observed.
- **`src/workflow-run/drive-accepted-run.ts:109`** — `publishOnDone` runs after the run is already marked `done`, so a PR publish failure leaves a run terminally `done` with no handoff/PR. _Fix:_ publish before terminal `done`, or catch and move run to `blocked` with a blocked handoff.
- **`src/workflow-run/executor-actions.ts:26`** — Action execution globally deduped by `actionId`, so verifier-driven retries skip `run-validation-profile` and reuse stale validation. _Fix:_ scope dedupe by attempt/state/phase, or allow validation actions to rerun.
- **`src/workflow-run/intake-core.ts:144`** — Intake claims idempotency mappings before the run record is written; a crash between claim and write permanently poisons future duplicate intake (ENOENT loop). _Fix:_ transactional claim (`pending`→`committed`) with recovery, or atomic create of run record + mapping.
- **`src/workflow-run/archive.ts:221`** — Run status updates unconditionally overwrite metadata without transition validation/CAS, so a concurrent cancel can be overwritten by `done`/`blocked`. _Fix:_ enforce valid status transitions under per-run lock/CAS; refuse writes from terminal states.

### Medium

- **`src/workflow-run/drive-accepted-run.ts:266`** — Attempt memory always written as `attempt-1`/`attemptNumber: 1`, overwriting prior attempt memory. _Fix:_ derive active attempt from run log or accept attempt identity as input.
- **`src/workflow-run/intake-core.ts:232`** — Retry intake computes `nextAttemptNumber` then appends without a lock, allowing duplicate attempt numbers. _Fix:_ allocate attempt numbers atomically in the archive append/lock layer.
- **`src/workflow-run/archive.ts:147`** — Event sequence assignment reads log before appending, so concurrent appends can receive the same `sequence`. _Fix:_ serialize appends per run, or order at projection time.
- **`src/workflow-run/verifier.ts:140`** — `runCouncilVerifier` doesn't catch thrown/rejected councillor calls, so one exception aborts the whole council. _Fix:_ wrap each `runCouncillor` and convert errors to failed councillor records.
- **`src/workflow-run/drive-accepted-run.ts:192`** — Blocked handoffs discard attempt memory and evidence refs written just before. _Fix:_ thread `memoryRecord`, artifacts, evidence into `writeBlockedHandoff` like the done path.
- **`src/workflow-run/slack-interactions.ts:109`** — Slack operator responses overwrite the artifact for the same `questionId` (no `ifNotExists`/nonce). _Fix:_ exclusive creation + duplicate-response result, or response nonce/timestamp.
- **`src/workflow-run/executor-event-log.ts:43`** — Hook evidence stringified directly into durable run-log messages, can leak secrets. _Fix:_ persist evidence references only, or redact before logging.
- **`src/workflow-run/intake-idempotency-store.ts:106`** — On `EEXIST` race, `claimMapping` reads the mapping file before another process finishes writing it (transient JSON parse failures). _Fix:_ temp-file + atomic link/rename, or retry on parse errors.
- **`src/workflow-run/gate-retry-controller.ts:62`** — `maxGateRetries` treated as a global budget but only one retry per evaluation is performed even when limit > 1. _Fix:_ loop retry/evaluate until pass or `retryAttemptsUsed >= maxGateRetries`.

### Low

- **`src/workflow-run/tracker-intake.ts:72`** — `acceptGitHubTriggeredWorkflowRun` and the Linear wrapper collapse `created`/`deduplicated`/`retried` into `workflow_run.started`, dropping retry attempt metadata. _Fix:_ return `WorkflowRunIntakeOutput` or extend started output with `action`/`runAttempt`.

---

## Slice 2 — `src/http/`

### High

- **`src/http/routes/config.ts:89`** — `GET /api/v1/config/overlay` returns the raw overlay map (unlike `/api/v1/config`), leaking `apiKey`/`githubSecret`/tokens/webhooks to read-token holders. _Fix:_ `sanitizeConfigValue()` on every overlay response (GET/PUT/PATCH).
- **`src/http/routes/setup.ts:42`** — `POST /api/v1/setup/master-key` echoes the submitted master key in the response (locked by `tests/http/setup-api.integration.test.ts:202`). _Fix:_ return `204`/`{ok:true}` and update the test to assert key absence.
- **`src/http/server.ts:95`** — Production only installs `express.json()`, but Slack interactive webhooks are `application/x-www-form-urlencoded`, so `/webhooks/slack` gets no `rawBody` and valid Slack requests fail signature handling. _Fix:_ add URL-encoded/raw-body parser for `/webhooks/slack` with raw-body capture + size limit.

### Medium

- **`src/http/write-guard.ts:96`** — Mutating routes allowed solely because TCP peer is loopback → CSRF/drive-by localhost POSTs and auth bypass via local proxies/tunnels when `RISOLUTO_WRITE_TOKEN` is unset. _Fix:_ require write token for all mutations, or enforce strict `Origin`/`Host` checks and disable loopback bypass when proxied. _(Re-ranked High→Medium on oracle re-verify: the loopback bypass is documented intentional design — exploitation requires operator misconfig (bound non-loopback + write token unset) plus an attacker with local reach.)_
- **`src/http/routes/webhooks.ts:45`** — Webhook rate-limit key includes attacker-controlled delivery IDs, so unique `x-github-delivery`/`linear-delivery` values bypass the per-IP limit. _Fix:_ rate-limit by IP + route only; use delivery ID for dedupe after auth.
- **`src/http/routes/system.ts:87`** — `/metrics` is a public read endpoint not covered by `read-guard`, exposing operational data when bound beyond loopback. _Fix:_ protect `/metrics` or require a metrics token.
- **`src/http/service-errors.ts:54`** — Malformed JSON from `express.json()` not recognized as client parse error, falls through to 500. _Fix:_ honor body-parser `status/statusCode` or `type === "entity.parse.failed"` → 400.
- **`src/http/service-errors.ts:37`** — Every `TypeError` treated as 400 with raw message returned, hiding server bugs and disclosing internals. _Fix:_ explicit validation error classes; log unexpected `TypeError`s and return generic 500.
- **`src/http/read-guard.ts:114`** — `?read_token=` accepted on all protected reads (not just SSE), increasing token leakage via URLs/history/referrers. _Fix:_ allow query-token only for `/api/v1/events` or use short-lived SSE tickets.
- **`src/http/query-params.ts:4`** — Shared `parseLimit()` accepts any positive integer with no upper bound (expensive reads). _Fix:_ clamp to a small per-endpoint max (cf. audit's 1000 cap).
- **`src/http/routes/codex.ts:17`** — Codex admin pagination uses `parsePositiveInteger()` with no max. _Fix:_ clamp `limit` to a documented max.
- **`src/http/routes/codex.ts:40`** — Codex control-plane failures return `error.message` directly, leaking upstream/internal details on an admin surface. _Fix:_ log server-side, return generic `codex_request_failed` + request ID.
- **`src/http/git-context.ts:226`** — GitHub enrichment trusts `config.github.apiBaseUrl` and sends the GitHub token to it (SSRF/token-exfil). _Fix:_ allowlist GitHub/approved enterprise hosts before authenticated requests.
- **`src/http/dep-validator.ts:41`** — HTTP startup rejects any configured Trigger API without a tracker dependency even when enabled actions are only `re_poll`/`refresh_issue`. _Fix:_ require `tracker` only when `allowedActions` includes `create_issue`.

### Low

- **`src/http/routes/workflow-runs.ts:73`** — Workflow Run creation manually `safeParse`s and returns a generic validation error without Zod issue details. _Fix:_ use `validateBody(createWorkflowRunSchema)` or include formatted Zod details.

---

## Slice 3 — `src/orchestrator/`

### Critical

- **`src/orchestrator/worker-launcher.ts:475`** — `launchWorker` can continue through awaited workspace/template prep and start `agentRunner.runAttempt` after `Orchestrator.stop()` has already enumerated/aborted workers, leaving an orphan worker running after shutdown. _Fix:_ pass `isRunning` into `LaunchContext`; re-check inside the lock before `runningEntries.set(...)` and again before `runAttempt(...)`, releasing the claim and resolving the lifecycle promise if stopped.

### High

- **`src/orchestrator/worker-launcher.ts:548`** — `workerPromise.finally(...)` can reject unhandled if `handleWorkerPromise` fails during outcome/failure handling (unhandled rejection / crash). _Fix:_ attach `.catch(...)`, or use an async wrapper that catches/logs and always resolves `entry.promise`.
- **`src/orchestrator/orchestrator.ts:123`** — If `runStartupRecovery(...)` throws in `start()`, `_state.running` stays `true` and the watchdog stays started, so later `start()` calls return early against a half-started orchestrator. _Fix:_ wrap startup recovery in try/catch; stop watchdog, clear timers/state, set `running=false`, rethrow.
- **`src/orchestrator/orchestrator.ts:180`** — `stop()` waits indefinitely on `Promise.allSettled(workers.map(w => w.promise))`; a worker ignoring abort hangs shutdown forever. _Fix:_ bound wait with a shutdown timeout, log stuck workers, force cleanup per policy.

### Medium

- **`src/orchestrator/lifecycle.ts:23`** — Running entries whose tracker issue is missing from `fetchIssueStatesByIds` are silently left running (unlike retry entries). _Fix:_ treat missing running issues as orphaned: mark stopping, abort with reason, decide `cleanupOnExit`.
- **`src/orchestrator/recovery.ts:36`** — Startup recovery only processes the latest `running` attempt per issue, leaving older persisted `running` attempts stuck after a crash. _Fix:_ process all running attempts; resume newest resumable, mark older duplicates failed/superseded.
- **`src/orchestrator/recovery.ts:173`** — Container cleanup aborts on first `removeContainer` failure, preventing attempt status cleanup/escalation. _Fix:_ per-container try/catch, collect failures, continue to mark attempt failed/paused with cleanup errors in metadata.
- **`src/orchestrator/worker-outcome/prepare.ts:16`** — Tracker refresh failures are swallowed and replaced with the stale issue, so terminal tracker state can be missed. _Fix:_ distinguish transient failure from "unchanged"; fail into safe retry/error path or defer finalization.
- **`src/orchestrator/retry-coordinator.ts:217`** — When retry launch is blocked by concurrency/state limits, `queueRetry(..., 1_000, ...)` re-emits a critical retry notification every second. _Fix:_ reschedule in-place without repeated notifications, or throttle/coalesce.

### Low

- **`src/orchestrator/orchestrator.ts:82`** — Config-store subscription created in constructor is never unsubscribed; stopped instances remain referenced by `ConfigStore`. _Fix:_ store unsubscribe and call in `stop()`/dispose.
- **`src/orchestrator/orchestrator.ts:85`** — `health.transition` event-bus listener never removed, leaking listeners across instance churn. _Fix:_ keep handler ref and `eventBus.off("health.transition", handler)` on stop/dispose.
- **`src/orchestrator/core/lifecycle-state.ts:271`** — `sessionUsageTotals` appended per session but never cleared after terminal outcome, unbounded memory growth. _Fix:_ delete `sessionId` when the attempt leaves `runningEntries`.
- **`src/orchestrator/worker-launcher.ts:46`** — `operatorAbortSuppressions` entries only pruned if the same issue reappears with changed fingerprint; aborted issues accumulate indefinitely. _Fix:_ clear on terminal cleanup, or cap/expire the map.

---

## Slice 4 — `src/agent-runner/`, `src/agent/`, `src/dispatch/`

### Critical (security)

- **`src/agent/codex-request-handler.ts:164`** — Codex command/file approval requests always answered with `acceptForSession`, so a model can turn an approval-gated command/file write into unattended execution for the whole session. _Fix:_ deny by default or route approvals through an operator/policy gate.

### High

- **`src/agent-runner/docker-session.ts:180`** — Abort handler sets `teardownStarted` and only stops the container; later `cleanup()` returns early at `:210`, leaking the stats interval, container removal, and cache volume cleanup. _Fix:_ share one idempotent full-cleanup path that always clears timers/listeners and removes container/volume.
- **`src/agent-runner/docker-session.ts:95`** — `config.codex.command` passed as a single command string to a shell-executed Docker entrypoint, so metacharacters are executable if config/request data is compromised. _Fix:_ validated argv or allowlist, not a shell string.
- **`src/agent-runner/docker-session.ts:139`** — Docker CLI child inherits full host `process.env`, exposing unrelated secrets. _Fix:_ minimal whitelisted env; inject provider secrets via explicit required-env mechanism.
- **`src/agent-runner/notification-handler.ts:60`** — Live streaming emits raw buffered agent/command output without `sanitizeContent` (unlike final item events), leaking secrets via SSE/logs/event storage. _Fix:_ sanitize/redact `buffer.content` before every live `onEvent`.
- **`src/agent/json-rpc-connection.ts:190`** — Raw JSON-RPC notification params debug-logged, and stderr logged raw at `:53`; both can contain output/prompts/tokens/auth. _Fix:_ redact structured params and stderr, or log only method names + bounded diagnostics.
- **`src/dispatch/server.ts:89`** — `activeDispatches.set(runId, abortController)` overwrites an existing active run with the same id, making the first unabortable and letting either run's `finally` delete the other's controller. _Fix:_ reject duplicate active `runId` with 409, or key by `(runId, attempt)` and delete only if stored controller matches.
- **`src/dispatch/server.ts:92`** — SSE request has no `close`/disconnect handler, so a control-plane/client disconnect can keep the agent attempt running indefinitely. _Fix:_ `req.on("close")`/`res.on("close")` to abort, distinguishing normal completion.
- **`src/agent-runner/exit-classifier.ts:20`** — Child exits by signal have `code === null`, so a SIGKILL/SIGTERM crash falls through to `"normal"` at `:44`. _Fix:_ treat non-null `exitState.signal` as failure unless the run signal was intentionally aborted.
- **`src/agent-runner/turn-executor.ts:261`** — Exhausting `maxTurns` returns `null`, and `classifyExitState` then reports `"normal"`, so an unfinished agent is marked successful. _Fix:_ return explicit failed/blocked outcome (`max_turns_exceeded`).
- **`src/dispatch/client.ts:106`** — Remote dispatch serializes full `ServiceConfig` + Codex auth into the request body, and the default remote URL is plain HTTP (`factory.ts:43`). _Fix:_ require TLS/mTLS or private transport, avoid sending secret-bearing config, resolve secrets on the data plane.

### Medium

- **`src/agent-runner/turn-state.ts:143`** — `waitForTurnCompletion` doesn't check `input.signal.aborted` before registering the abort listener, so an already-aborted signal waits until timeout. _Fix:_ reject immediately when already aborted.
- **`src/dispatch/client.ts:23`** — `DispatchClient.runAttempt` drops optional `workflowRun`, `previousThreadId`, `onSteerReady`, so remote attempts can't resume threads or steer. _Fix:_ include these in client input/request and forward via `server.ts`.
- **`src/dispatch/client.ts:209`** — `parseDispatchStream` records an outcome but keeps reading until server closes, so a data plane that keeps the connection open makes the client hang. _Fix:_ break the read loop and cancel/release the reader once an outcome is parsed.
- **`src/agent-runner/attempt-executor.ts:214`** — `runtime.shutdown()` failures in `finally` can override the computed run outcome and prevent `runAfterRun`. _Fix:_ catch/log shutdown errors separately, preserve outcome, run `afterRun` regardless.
- **`src/agent-runner/docker-session.ts:226`** — `removeVolume(cacheVolumeName)` awaited without catch in cleanup, so a Docker cleanup failure rejects the whole attempt. _Fix:_ log and continue returning the outcome, surface cleanup telemetry.

---

## Slice 5 — `src/persistence/`, `src/state/`

No SQL injection found (Drizzle predicates, not string interpolation).

### High

- **`src/persistence/sqlite/migrator.ts:162`** — `safeReaddir` swallows all directory read failures, so permission/I/O errors look like "no archive files" and `initPersistenceRuntime` can mark JSONL migration complete → silent data loss. _Fix:_ only return `[]` for `ENOENT`; rethrow/hard-fail on permission/I/O; write migration flag only after a verified scan.
- **`src/persistence/sqlite/database.ts:432`** — v6 `pull_requests` migration drops the original table outside a transaction after copying rows; a crash before rename/version bump leaves the DB without the original table. _Fix:_ wrap rebuild/copy/drop/rename/index/version in one transaction.
- **`src/persistence/sqlite/webhook-inbox.ts:183`** — `fetchDueForRetry` reads due retries without atomically claiming them, and `markProcessing` is unconditional, allowing multiple workers to process the same delivery. _Fix:_ atomic claim (`UPDATE ... WHERE status='retry' AND due RETURNING ...`) or txn with status CAS.

### Medium

- **`src/persistence/sqlite/attempt-store-sqlite.ts:79`** — `updateAttempt` does non-atomic read-merge-write of the whole row, so concurrent partial updates overwrite unrelated fields. _Fix:_ build `SET` from provided patch fields only, or use txn/version check.
- **`src/persistence/sqlite/database.ts:155`** — Fresh `attempt_checkpoints` tables created without `REFERENCES attempts(attempt_id)` though the Drizzle schema declares the FK (orphan checkpoints). _Fix:_ add FK to `CREATE_TABLES_SQL` and v5 migration/rebuild path.
- **`src/persistence/sqlite/attempt-store-sqlite.ts:137`** — Checkpoint dedup ignores `eventCursor`, `tokenUsage`, `metadata`, `createdAt`, dropping distinct recovery/evidence checkpoints. _Fix:_ dedupe on full persisted-field comparison.
- **`src/persistence/sqlite/runtime.ts:71`** — Default prompt template seeding and `config.system.selectedTemplateId` update are not transactional; a crash after insert leaves config unpatched forever. _Fix:_ wrap seeding in a transaction; make config update idempotent regardless of table emptiness.
- **`src/persistence/sqlite/migrator.ts:112`** — Event rows inserted even when their attempt file was skipped/corrupt, so an orphan event FK violation aborts the whole migration. _Fix:_ track parsed attempt IDs and skip/log events whose `attemptId` is absent before the DB transaction.
- **`src/persistence/sqlite/runtime.ts:107`** — `initPersistenceRuntime` opens the DB then runs migration/seeding without try/finally, leaking the connection/file locks on throw. _Fix:_ close DB in catch before rethrowing.
- **`src/persistence/sqlite/database.ts:587`** — `openDatabase` doesn't close the raw `better-sqlite3` handle if schema creation/migration throws. _Fix:_ wrap pragmas/schema/migrations in try/catch and `sqlite.close()` before rethrowing.

### Low

- **`src/persistence/sqlite/mappers.ts:90`** — `parseJsonSafe` silently converts invalid JSON metadata to `null` and casts any JSON to `Record<string, unknown>`, hiding corruption. _Fix:_ validate parsed metadata is a plain object; throw contextual corruption error or log with row identifiers.
- **`src/persistence/sqlite/webhook-inbox.ts:246`** — `getRecent` accepts unclamped caller `limit`. _Fix:_ normalize/clamp with existing `normalizeLimit`/`clampLimit`.

---

## Slice 6 — `src/config/`, `src/secrets/`

### High

- **`src/secrets/store.ts:143`** — `activeMasterKey` set before the existing archive is successfully decrypted, so a wrong-key `start()` leaves the instance able to later overwrite the real `secrets.enc`. _Fix:_ assign key only after decrypt/load succeeds; clear on every failure path.
- **`src/secrets/store.ts:231`** — `set()` mutates the plaintext cache before verifying a usable master key, so failed uninitialized writes leave secrets resident in memory and concurrent set/delete can persist a mismatched cache snapshot. _Fix:_ serialize the whole mutation, call `requiredMasterKey()` before mutating cache.
- **`src/secrets/db-store.ts:68`** — `DbSecretsStore.start()` accepts any non-empty master key without proving rows decrypt, while `get()` returns `null` on decrypt failure, making wrong-key startup look like "missing secrets." _Fix:_ store-level decrypt sentinel, or verify existing rows at startup and fail on mismatch.
- **`src/config/db-store.ts:138`** — DB config mutations write sections before deriving/validating, so a bad overlay can persist even when `refresh()` throws. _Fix:_ derive/validate candidate before commit, or wrap write+refresh in a rollback transaction.
- **`src/config/merge.ts:27`** — `deepMerge()` copies untrusted keys without filtering `__proto__`/`constructor`/`prototype`, so loaded YAML/DB config can pollute the prototype. _Fix:_ reject dangerous keys recursively; build with `Object.create(null)` + own-property access.

### Medium

- **`src/config/db-store.ts:101`** — `DbConfigStore` accepts a `secretsStore.subscribe` dep but never subscribes, so configs derived from `$SECRET:*` stay stale after rotation. _Fix:_ subscribe to secret changes and refresh+notify, or resolve secrets lazily.
- **`src/config/db-store.ts:40`** — Invalid JSON in persisted DB config silently replaced with `{}`, running on defaults instead of treating corruption as unsafe. _Fix:_ reject refresh, keep last-known-good, expose error/health state.
- **`src/config/derivation-pipeline.ts:78`** — Exported Zod schemas effectively bypassed during service-config derivation, so defaults/range checks don't protect runtime config. _Fix:_ parse each derived section through its schema (or remove dead schemas and validate in builders).
- **`src/config/section-builders.ts:257`** — `server.port` accepted as any finite number (including `0`, negative, float, >65535). _Fix:_ validate/coerce as integer TCP port in `[1, 65535]`.
- **`src/config/overlay.ts:64`** — An `unlink` watcher event reloads missing overlay files as `{}`, so atomic-save workflows can transiently clear config and notify subscribers. _Fix:_ debounce `unlink` or wait for replacement/add event.
- **`src/secrets/store.ts:306`** — `secrets.enc` written with default permissions and without fsyncing temp file/dir, so a permissive umask exposes archives and durability isn't guaranteed. _Fix:_ write with `0o600`, fsync file + containing dir before/after rename.
- **`src/config/validators.ts:42`** — Dispatch validation rejects every tracker kind except `"linear"` though builders/URL policy support `"github"`. _Fix:_ validate by tracker kind (Linear: API key/project slug; GitHub: owner/repo/token).

### Low

- **`src/secrets/store.ts:256`** — Store notifications call listeners without isolation, so one throwing listener prevents later listeners and makes a successful mutation appear failed (same pattern in overlay/DB stores). _Fix:_ wrap each listener in try/catch and log failures.

---

## Slice 7 — `src/cli/`, `src/setup/`

No direct `exec`/`spawn` from CLI args; main injection risk is unvalidated values persisted by setup and later consumed by git/runtime.

### High

- **`src/setup/setup-service.ts:85`** — `provider.baseUrl` concatenated into the OpenAI validation URL and the API key is sent to that arbitrary host (key exfil/SSRF). _Fix:_ parse/validate provider URLs, require `https`, block loopback/private/link-local unless explicitly trusted, send keys only to approved origins.
- **`src/setup/setup-service.ts:72`** — `defaultBranch` accepted as any non-empty string and persisted into repo routes; later used as a git ref/start point (option/ref injection / persistent invalid state). _Fix:_ strict git-ref policy (`git check-ref-format --branch`, reject leading `-`/whitespace/control chars).
- **`src/setup/setup-service.ts:240`** — `createMasterKey()` returns the plaintext master key in the API response. _Fix:_ don't echo provided keys; for generated keys use a one-time local file/download flow, never in generic JSON/loggable paths.
- **`src/setup/setup-service.ts:235`** — Master key file written before `secretsStore.initializeWithKey()` succeeds, so a decrypt/init failure leaves a bad `master.key` on disk. _Fix:_ validate/decrypt first, then atomically write; rollback temp file on failure.

### Medium

- **`src/setup/handlers/openai-key.ts:41`** — Setup handlers return raw exception messages during secret-saving, leaking provider details/paths/secret-adjacent content. _Fix:_ generic public error codes; log only redacted diagnostics.
- **`src/setup/setup-service.ts:272`** — `saveOpenaiKey()` writes secret and auth-mode overlay separately then mutates provider config, so partial failure leaves inconsistent state. _Fix:_ stage overlay + secret write transactionally, or rollback.
- **`src/setup/setup-service.ts:293`** — `saveCodexAuth()` writes token-bearing `auth.json` before overlay updates succeed, leaving live creds in a half-configured setup. _Fix:_ temp file → atomic config update → rename; delete temp/auth on failure.
- **`src/setup/setup-service.ts:250`** — `selectLinearProject()` persists `tracker.project_slug` before `orchestrator.start()`, so a startup failure looks configured. _Fix:_ start/probe first, or rollback slug on failure.
- **`src/setup/setup-service.ts:161`** — `fetchDefaultBranch()` silently ignores authenticated GitHub failures and retries unauthenticated, masking bad/expired tokens. _Fix:_ only fall back unauthenticated when no token exists; surface auth failures distinctly.
- **`src/setup/setup-service.ts:465`** — `detectDefaultBranch()` catches every failure and returns `"main"`, hiding private/not-found/rate-limit/network errors. _Fix:_ default only on explicit user choice or narrow non-fatal cases; otherwise typed setup error.

### Low

- **`src/cli/workflow-run-workspace-command.ts:114`** — `--retention-days` uses `Number.parseInt`, accepting `7abc` as `7`. _Fix:_ full decimal integer regex + safe upper bound.
- **`src/cli/workflow-run-worker-process-command.ts:52`** — `--exit-code` uses `Number()`, accepting `0x10`/`1e3`. _Fix:_ `/^(0|[1-9]\d*)$/`, convert, cap to valid exit-code range.
- **`src/cli/workflow-run-start-command.ts:30`** — `workflow-run start` hard-codes `.risoluto/workflows` while `run start` supports `--workflow-dir`. _Fix:_ add `--workflow-dir` or route both through the same intake resolver.
- **`src/cli/run-command.ts:30`** — `run status` allows arbitrary extra positionals, silently ignored. _Fix:_ reject `positionals.length !== 1` with usage error.
- **`src/cli/index.ts:317`** — Top-level catch prints the raw `Error` (stack/cause) to stderr. _Fix:_ format known errors concisely; redact/suppress stack unless a debug flag is set.

---

## Slice 8 — `src/core/`, `src/utils/`

### High

- **`src/utils/retry.ts:26`** — `withRetry` swallows the final error and returns success after max attempts, making failed write-back/mutation operations look successful. _Fix:_ rethrow on final failure by default, or split into `withNonFatalRetry` used only where failure is truly ignorable. _(Re-framed on oracle re-verify: the void-returning `withRetry`'s swallow-on-final-failure is explicitly documented/intentional, and `withRetryReturn` already rethrows. The real bug is at the **call sites** — `linear/client.ts:331,341,351,374,578` and `tracker/github-adapter.ts:65,67,69,74` use the void variant for state mutations (updateWebhook/updateIssueState/addLabel/closeIssue/reopenIssue/createComment), so a swallowed failure diverges orchestrator state from the tracker with no retry path. Severity stays High; fix the call sites, not `withRetry`.)_
- **`src/core/error-tracking.ts:52`** — `captureException` logs raw `error.message`, `stack`, breadcrumbs, contexts, and caller context, so secrets in params/headers/errors get persisted. _Fix:_ run all tracking payloads through `redactSensitiveValue` (incl. breadcrumbs/contexts).
- **`src/core/content-sanitizer.ts:324`** — Raw-text assignment redaction recognizes only a small exact key list, so `SLACK_SIGNING_SECRET=...`, `OPENAI_API_KEY=...`, `GITHUB_TOKEN=...` leak if the value lacks a known prefix. _Fix:_ parse assignment keys with boundaries and apply the broader `REDACT_KEYS` matcher.
- **`src/core/content-sanitizer.ts:348`** — Generic secret assignment redaction stops at whitespace, so `Authorization: Basic dXNlcjpwYXNz` → `[REDACTED] dXNlcjpwYXNz` leaks the credential. _Fix:_ special-case authorization/password keys to consume the full segment.
- **`src/core/content-sanitizer.ts:417`** — `redactSensitiveValue` structured-clones non-plain objects then walks `Object.entries`, so `Map`/`Set`/`Headers`/`URLSearchParams`/`Error` retain embedded secrets. _Fix:_ normalize/recursively handle common non-plain containers.

### Medium

- **`src/core/event-bus.ts:58`** — A throwing listener aborts delivery to later channel + all wildcard listeners (one bad subscriber suppresses telemetry/notifications). _Fix:_ per-listener try/catch + logging, or define `emit` fail-fast with a separate safe broadcast.
- **`src/core/event-bus.ts:58`** — `emit` iterates the live listener `Set`, so handlers that add/remove during emission affect delivery. _Fix:_ snapshot listeners (`[...set]`) before iteration.
- **`src/utils/retry.ts:20`** — `maxAttempts` unvalidated; `0`/negative/fractional/`NaN` can skip the operation or cause inconsistent final-error behavior. _Fix:_ require positive safe integer; throw config error otherwise.
- **`src/utils/retry.ts:33`** — Exponential backoff unbounded, so large attempt counts overflow Node timer limits and collapse into near-immediate retries. _Fix:_ cap delay; validate `maxAttempts`.
- **`src/utils/tool-call-result.ts:15`** — `JSON.stringify` can return `undefined` for unsupported top-level values or throw on `bigint`/cycles, violating the `text: string` contract. _Fix:_ safe serializer that always returns a string with placeholders for unsupported/cyclic values.
- **`src/core/signal-detection.ts:29`** — Stop-signal regexes only enforce a trailing boundary and match anywhere, so quoted text like `notrisoluto_status: done` or "do not output RISOLUTO*STATUS: DONE" can falsely terminate a run. \_Fix:* require leading boundary/line-level marker or prefer structured JSON-only termination.
- **`src/core/model-pricing.ts:43`** — `computeAttemptCostUsd` trusts token counts, so negative/`NaN`/infinite values propagate into invalid cost totals. _Fix:_ validate token counts as finite non-negative safe integers; return `null`/throw on invalid.

### Low

- **`src/core/attempt-analytics.ts:5`** — `sortAttemptsDesc` sorts timestamps lexicographically, misordering offset/non-`Z`-normalized ISO timestamps. _Fix:_ compare parsed epoch millis with deterministic fallbacks.

---

## Slice 9 — `src/linear/`, `src/tracker/`, `src/github/`, `src/webhook/`

### High

- **`src/linear/graphql-tool.ts:42`** — `linear_graphql` only enforces "one operation" and allows arbitrary Linear mutations/secret-bearing queries from agent tool calls. _Fix:_ allowlisted read-only operation set; reject `mutation`/`subscription` and sensitive fields like webhook secrets.
- **`src/webhook/github-handler.ts:79`** — GitHub replay protection depends on unsigned `X-GitHub-Delivery`, so a captured valid signed body can be replayed with a new delivery id. _Fix:_ dedupe on a digest of the verified raw body/signature in addition to delivery id; persist replay attempts.
- **`src/webhook/delivery-workflow.ts:74`** — Handlers return `200` before side effects run, and later failures are only logged, so providers won't retry and the delivery is already deduped. _Fix:_ persist processing state with retry/DLQ before acking, or return non-2xx until durable handoff succeeds.

### Medium

- **`src/webhook/linear-handler.ts:124`** — Linear dedupe trusts unsigned `Linear-Delivery`; replaying the same signed body with a new delivery id within the window bypasses dedupe. _Fix:_ include raw-body/signature hash in the inbox uniqueness/replay check.
- **`src/webhook/linear-handler.ts:133`** — Linear webhooks silently process without a `webhookInbox`, disabling durable idempotency (unlike GitHub). _Fix:_ require inbox persistence before accepting verified Linear deliveries.
- **`src/webhook/slack-handler.ts:118`** — Slack modal submissions have signature/timestamp checks but no delivery/view/body dedupe, so retries create duplicate Workflow Runs. _Fix:_ persist and dedupe by Slack `view.id` + raw-body/signature hash.
- **`src/linear/queries.ts:232`** — `listWebhooks` requests the `secret` field for every webhook even though listing/health doesn't need it. _Fix:_ remove `secret` from list queries; only handle the secret from `webhookCreate`.
- **`src/linear/queries.ts:224`** — Linear webhook listing capped at `first: 50` with no pagination, missing registrations after page one (duplicate creation). _Fix:_ paginate until `hasNextPage=false`.
- **`src/linear/client.ts:331`** — `updateWebhook` uses the non-throwing retry helper, so code can believe a disabled webhook was re-enabled after all retries failed. _Fix:_ strict retry path for registration-critical mutations; assert the GraphQL success payload.
- **`src/linear/client.ts:310`** — `createWebhook` returns parsed fields without checking `webhookCreate.success` or requiring a non-empty id. _Fix:_ validate `success === true`, id presence, expected secret semantics before storing.
- **`src/github/issues-client.ts:173`** — GitHub `/issues` returns PRs too, and the client doesn't filter `pull_request`, so PRs are treated as Tracker Issues. _Fix:_ add `pull_request?: unknown` to the raw type and filter PR-backed records out.
- **`src/github/issues-client.ts:173`** (via `src/tracker/github-adapter.ts:37`) — GitHub candidate polling only requests `state=open`, so closed issues with terminal labels are never fetched (port contract expects active + terminal). The `?state=open` is hardcoded in `fetchOpenIssues` at `issues-client.ts:173`; `github-adapter.ts:37` just calls it. _Fix:_ fetch `state=all` when terminal states are projected, or fetch closed/terminal separately. _(Line corrected on oracle re-verify: original cited `github-adapter.ts:37`; the actual hardcoded query string is at `issues-client.ts:173`.)_
- **`src/tracker/github-adapter.ts:65`** — GitHub state transitions only add the new label and never remove old state labels (ambiguous board state). _Fix:_ remove other configured active/terminal labels before/after adding the target.
- **`src/github/issues-client.ts:141`** — GitHub HTTP errors ignore response body and rate-limit headers; no `Retry-After`/`X-RateLimit-Reset` handling. _Fix:_ parse error payload/headers, map 403/429 distinctly, retry respecting reset timing.

### Low

- **`src/github/issues-client.ts:273`** — `ensureLabel` treats every GitHub `422` as "label already exists," masking validation errors (invalid color/name). _Fix:_ inspect the 422 payload and only fall back to GET on the duplicate-label condition.

---

## Slice 10 — `src/git/`, `src/workspace/`, `src/docker/`

### High

- **`src/docker/workspace-mounts.ts:31`** — A workspace-controlled `.git` pointer can mount arbitrary host directories (e.g. `/home/...`) into the container because the code trusts `gitdir`/`commondir` with only a small denylist. _Fix:_ don't derive mounts from workspace file contents; mount only known `gitBaseDir`, or realpath-allowlist paths under `<workspace.root>/.base`.
- **`src/docker/spawn.ts:220`** — `sandboxConfig.image` appended where Docker still parses options, so an image starting with `--...` becomes a Docker flag before `bash` is treated as the image. _Fix:_ validate image refs strictly, reject leading `-`, optionally insert Docker's option terminator.
- **`src/workspace/manager.ts:147`** — Existing symlinks accepted as workspace dirs because `stat()` follows symlinks, letting hooks/cleanup operate outside the root. _Fix:_ `lstat()` + `realpath()`; reject symlinks or real paths outside the root.
- **`src/git/manager.ts:213`** — `diffNameOnly()` and `diffShortStat()` silently convert git diff failures into empty/zero results, so auto-merge policy can treat an unknown diff as safe. _Fix:_ propagate diff failures or return an explicit "diff unavailable" result that blocks auto-merge.

### Medium

- **`src/git/worktree-manager.ts:71`** — `repoUrl` passed to `git clone` without `--` or URL validation, so a route repo URL beginning with `-` can be parsed as a git option. _Fix:_ validate URL schemes and call `git clone ... -- <repoUrl> <dir>`.
- **`src/git/manager.ts:47`** — Tracker/config branch names only checked for a leading dash, not validated as git refs before checkout/worktree/push. _Fix:_ validate with `git check-ref-format --branch`, reject refspec-like names.
- **`src/git/worktree-manager.ts:63`** — Base clone creation has no per-repo lock or atomic temp-dir flow, so concurrent setup for the same repo races cloning/fetching. _Fix:_ serialize by `baseDir`, clone into temp dir then atomic rename.
- **`src/git/worktree-manager.ts:129`** — `branchExists()` checks only local `refs/heads`, so an existing remote PR branch is missed and a new local branch is created from default. _Fix:_ also check `refs/remotes/origin/<branch>` and attach/create tracking worktrees from the remote.
- **`src/workspace/manager.ts:93`** — Public `ensureWorkspace()`/removal methods don't acquire the module lock themselves, so callers forgetting `withLock()` race creation/cleanup. _Fix:_ acquire the lock inside public lifecycle methods, keyed by resolved workspace key.
- **`src/workspace/manager.ts:305`** — Worktree removal falls back to `rm()` without pruning git worktree metadata, leaving stale registrations/locks. _Fix:_ run `git worktree prune` for the base clone after fallback removal, or require stored `gitBaseDir`.
- **`src/workspace/manager.ts:351`** — Workspace hooks pipe stdout but never drain it, and timeout rejection happens before the child fully exits (deadlock/cleanup races). _Fix:_ drain/ignore stdout and resolve/reject only after SIGTERM/SIGKILL exit.

### Low

- **`src/workspace/paths.ts:36`** — Empty `issueIdentifier` sanitizes to an empty `workspaceKey`, resolving the workspace path to the workspace root; `removeDirectoryWorkspace` (`src/workspace/manager.ts:255`) can then delete the whole root. _Fix:_ reject empty sanitized keys and `workspacePath === workspaceRoot`. _(Re-ranked High→Low on oracle re-verify: real in code but no reachable caller constructs an empty identifier — all callers pass a tracker `issue.identifier`; defense-in-depth only.)_

---

## Slice 11 — `src/codex/`, `src/prompt/`

### High

- **`src/codex/control-plane.ts:332`** — Host-side Codex approval requests for command execution, file changes, and permissions are auto-accepted for the session, letting a compromised prompt/agent perform privileged actions without an operator gate. _Fix:_ deny by default or route through an explicit, auditable policy/approval workflow.
- **`src/codex/control-plane.ts:360`** — All Codex notification `params` emitted raw on the event bus, exposing prompt text, tool args, account/thread metadata, or secrets. _Fix:_ emit event-specific allowlisted fields; redact known secret/prompt-bearing keys.
- **`src/codex/token-refresh.ts:192`** — `writeFile(..., { mode: 0o600 })` doesn't fix permissions on an existing permissive `auth.json`, so refreshed tokens can stay world/group-readable. _Fix:_ explicit `chmod(authJsonPath, 0o600)` after write, or temp-file + atomic rename+chmod.

### Medium

- **`src/prompt/template-policy.ts:4`** — Policy allows raw `issue.*`, `workflowRun.*`, `workspace.*` interpolation, so tracker/user-controlled titles/descriptions can inject instructions into the Codex prompt. _Fix:_ render user-origin fields inside fenced/JSON-escaped blocks or require a safe quoting filter.
- **`src/prompt/resolver.ts:48`** — Resolved templates returned from storage without re-validating the body, so legacy/direct-DB templates bypass the current Liquid whitelist. _Fix:_ validate on `get`/resolution and fail closed on policy violation.
- **`src/codex/model-list.ts:38`** — Raw `OPENAI_API_KEY` value used as in-memory cache key, retaining the secret in a module-level `Map`. _Fix:_ cache by non-secret account/provider identity or a short fingerprint.
- **`src/codex/runtime-config.ts:116`** — Literal provider `httpHeaders`/`queryParams` serialized into generated Codex config, making accidental `Authorization`/API-key values part of temp artifacts/worker payloads. _Fix:_ reject sensitive header/query names in literal maps; require `envKey`/`envHttpHeaders` indirection.
- **`src/codex/token-refresh.ts:182`** — Successful token-refresh responses cast without schema validation, so a malformed 2xx can write an invalid auth record. _Fix:_ validate `access_token`/`token_type`/`expires_in` before writing.
- **`src/codex/model-list.ts:57`** — `fetchCodexModels` swallows every failure and returns the static list, hiding auth/protocol/API failures. _Fix:_ fallback only for known local-unavailable cases; log structured context; surface auth/protocol failures.

### Low

- **`src/prompt/store.ts:22`** — Preview sample context omits `workflowRun` though `workflowRun.*` is allowed, so valid templates fail preview. _Fix:_ add representative `workflowRun` sample data to `buildSampleContext`.
- **`src/codex/admin-service.ts:51`** — `readThreads` accepts `query.cwd` but sends `cwd: undefined`, so callers can't filter by cwd. _Fix:_ pass `cwd: query.cwd` or remove the parameter.

---

## Slice 12 — `src/health/`, `src/observability/`, `src/alerts/`, `src/audit/`, `src/notification/`, `src/automation/`, `src/live/`

### High

- **`src/alerts/alert-pipeline.ts:135`** — Alert notifications embed the entire raw event `payload` into `metadata`, then persist + send to Slack/webhooks, leaking `system.error.context`/`codex.*.params`/agent content. _Fix:_ replace `metadata.payload` with an allowlisted/redacted per-event summary.
- **`src/audit/logger.ts:81`** — Audit redaction only triggers when `tableName === "secrets"`, so config mutations with webhook URLs/API keys/tokens/`$SECRET`-resolved values are stored verbatim in `previousValue`/`newValue`. _Fix:_ redact by key/path/value policy before insert.
- **`src/health/health-runner.ts:126`** — Probe timeout only calls `AbortController.abort()` and still awaits `probe.run()`, so a non-cooperative probe hangs `tick()` forever. _Fix:_ enforce timeout with `Promise.race`, return synthetic down/timeout subprobe, ignore late results.
- **`src/notification/webhook-delivery.ts:35`** — Failed webhook responses include the full upstream body in thrown/logged errors, leaking echoed secrets/payloads. _Fix:_ log only status + short redacted diagnostic.
- **`src/notification/slack-webhook.ts:90`** — Slack payload renders unescaped user/event metadata in mrkdwn/code blocks (mention/link/code-fence injection, secret exposure). _Fix:_ escape Slack mrkdwn, neutralize broadcast mentions, omit/redact raw metadata.

### Medium

- **`src/notification/manager.ts:65`** — Notification dedupe remembered before delivery, so an all-failed delivery suppresses retries during the dedupe window. _Fix:_ remember only after a real success, or clear the key on all-failed.
- **`src/alerts/alert-pipeline.ts:51`** — Alert cooldown set before `notify()` and history persistence complete, so a thrown delivery error suppresses future alerts with no history record. _Fix:_ set cooldown after a recorded attempt; clear on throw.
- **`src/notification/manager.ts:93`** — Channels that skip internally (min severity/verbosity) return `void`, so the manager records them as delivered. _Fix:_ channels return `delivered | skipped`, or move severity filtering into the manager.
- **`src/audit/logger.ts:86`** — Audit rows are plain mutable SQLite records with no digest/previous-hash/signature, so tampering/deletion is undetectable. _Fix:_ append-only hash chain/HMAC verified on query/export.
- **`src/observability/hub.ts:56`** — Observability traces/sessions/health details persist arbitrary `data`/`metadata`/`details` without redaction. _Fix:_ sanitize by key/path/value pattern before storing snapshots.
- **`src/observability/metrics.ts:45`** — Prometheus label values interpolated without escaping quotes/backslashes/newlines (malformed/forged metric lines). _Fix:_ implement Prometheus label escaping for `\`, `"`, `\n`.
- **`src/automation/scheduler.ts:52`** — `start()` not idempotent; registers a fresh config subscription each call while overwriting the old unsubscribe (listener leak). _Fix:_ no-op if already started, or `stop()` before re-subscribing.
- **`src/health/probes/linear-probe.ts:39`** — `LinearProbe.run()` ignores `context.signal`, so Linear/tracker calls can't be cancelled by the runner timeout. _Fix:_ thread `AbortSignal` through `TrackerPort`, or wrap each subprobe in its own timeout race.
- **`src/live/preflight.ts:23`** — Live preflight provider checks use raw `fetch` without per-check timeout, so a hung endpoint hangs the whole preflight. _Fix:_ wrap each check with an `AbortController` timeout.

### Low

- **`src/health/health-runner.ts:156`** — `lastFailureAt` updated for `unknown` results even though unknown is non-failing for hysteresis. _Fix:_ update only for `slow`/`degraded`/`down`.
- **`src/automation/runner.ts:88`** — Completed automation paths notify before finalizing the run, so a rejecting notification manager converts success into failure. _Fix:_ finalize first; send completion notifications best-effort + logged.

---

## Slice 13 — `src/workflow-definition/`

No Critical/High findings.

### Medium

- **`src/workflow-definition/registry.ts:136`** — Workflow loading accepts every `.yaml/.yml` entry and `readFile`s it without rejecting symlinks/non-regular files or bounding size (DoS / read outside tree). _Fix:_ `readdir(..., { withFileTypes: true })`/`lstat`, reject symlinks/non-regular files, canonicalize under `workflowDir`, cap file size.
- **`src/workflow-definition/registry.ts:113`** — Duplicate Workflow Definition IDs silently collapsed by `new Map(...)`, letting one file shadow another (incl. the default). _Fix:_ detect duplicate `definition.id` before building the map; throw `WorkflowDefinitionRegistryError` naming both files.
- **`src/workflow-definition/registry.ts:92`** — Schema allows `states: []` and state `roles: []`, resolving a definition that executes with no role-driven traversal and skips gates/hooks. _Fix:_ require `states.min(1)` and `roles.min(1)` per state, or reject role-less states during reference validation.
- **`src/workflow-definition/registry.ts:95`** — State IDs not validated as unique, making duplicate-state gate/hook resolution ambiguous. _Fix:_ reject duplicate state IDs in `validateWorkflowDefinitionReferences`; add a test.

### Low

- **`src/workflow-definition/registry.ts:185`** — Role graph validation checks duplicate/unknown deps but doesn't reject dependency cycles at load time. _Fix:_ add cycle detection to `validateRoleGraph` so cyclic definitions fail at load.
- **`src/workflow-definition/registry.ts:142`** — YAML parse/read failures happen outside the `try`, and non-Zod errors rethrow without file context. _Fix:_ move read/parse into the wrapped block; include `filePath` in all registry error messages.

---

## Process note

Each slice was reviewed by an independent deep-review agent reading the actual source. Some agent tool outputs contained spurious `[JSON PARSE ERROR — IMMEDIATE ACTION REQUIRED]` text embedded _inside_ the results; this is injected noise, not a real tool failure. Worth tracking down where that string leaks into agent output from within this codebase.
