# `RISOLUTO_FEATURES.json` schema

Authoritative shape of the JSON sidecar. The markdown spine and the HTML viewer both derive from this. Treat it as the canonical store; if you change a field here, you must reflect it in `feature-entry-template.md`, `diff-section.md`, and the HTML template.

## Top-level

```jsonc
{
  "schema_version": "1.1",
  // Two-repo model: the spine lives in ONE repo, but cites code from another.
  "source_repo": {
    "url": "https://github.com/risolutohq/risoluto.git",  // where the cited code lives
    "local_path": ".spine-workspace/source",              // relative to time-aura repo root; used by validators
    "commit_sha": "cbf423b1234567890abcdef",
    "git_describe": "v0.9.0-90-gcbf423b",
    "head_date": "2026-04-19"
  },
  "storage_repo": {
    "url": "https://github.com/risolutohq/risoluto-research.git",  // where THIS spine file lives
    "submodule_path": "research"                                   // relative to time-aura repo root
  },
  // Legacy top-level fields kept for back-compat with v1.0 consumers; mirror source_repo.
  "commit_sha": "cbf423b1234567890abcdef",
  "git_describe": "v0.9.0-90-gcbf423b",
  "head_date": "2026-04-19",
  "generated_at": "2026-05-26T13:15:00Z",
  "previous_commit_sha": "a1b2c3d4...",   // null on cold start; refers to source_repo.commit_sha
  "previous_generated_at": "2026-04-19T10:00:00Z",
  "bundles": [
    "Notifications, Chat & Triggers",
    "Multi-Agent / Orchestration",
    "Persistence / State",
    "PR / CI",
    "Sandbox / Security",
    "Agent Runtime / Execution",
    "Dashboard",
    "Config",
    "Security / Auth",
    "Runtime",
    "Persistence"
  ],
  "features": [ /* see Feature record below */ ],
  "removed_features": [ /* feature records dropped since last run, kept one cycle */ ],
  "coverage": [ /* per-module accounting */ ],
  "summary": {
    "by_bundle": { "Notifications, Chat & Triggers": 10, /* ... */ },
    "total": 118,
    "confidence": { "high": 118, "medium": 0, "low": 0 }
  },
  "needs_followup": [ /* see Followup record */ ],
  "analyst_notes": { /* see Analyst notes record */ },
  "open_roadmap": {
    "count": 71,
    "epic_issue": 354,
    "bundle_count": 11,
    "as_of": "2026-04-04"
  },
  "latest_shipped_bundles": {
    "count": 22,
    "dates": ["2026-04-03", "2026-04-04"],
    "issues": [254, 258, 260, 262, 275, 276, 278, 282, 286, 292, 299, 303, 307, 308, 315, 318, 319, 326, 333, 335, 346, 375]
  }
}
```

## Feature record

```jsonc
{
  "id": "slack-block-kit-webhook",                    // stable kebab-case
  "bundle": "Notifications, Chat & Triggers",
  "name": "Slack Block Kit webhook channel",         // H3 in markdown
  "description": "Dedicated Slack delivery adapter that formats notifications as Block Kit payloads...",
  "how_it_works": "`SlackWebhookChannel.notify` serialises the event into a `{ text, attachments[].color, blocks[] }` payload, attaches the severity colour, and dispatches via `fetch` with a 10 s `AbortController` timeout.",
  "observable_behaviors": [
    "Severity colours: `\"#d32f2f\"` (critical), `\"#1d4ed8\"` (info).",
    "Timeout: `DEFAULT_TIMEOUT_MS = 10_000`; beyond that the channel aborts and records the failure.",
    "Default channel name: `\"slack_webhook\"`; `NotificationCenter.sendSlackTest` creates a one-shot instance as `\"slack_webhook_test\"`.",
    "Block layout: `header`, two `section` blocks, `context`, optional link section, optional metadata code-block (capped at 8 entries).",
    "Applies **both** `verbosity` and `minSeverity` gates — a channel set to `verbosity: \"critical\"` drops warning/info regardless of `minSeverity`."
  ],
  "citations": [
    {
      "path": "src/notification/slack-webhook.ts",
      "start_line": 116,
      "end_line": 170,
      "symbol": "SlackWebhookChannel",
      "kind": "class"
    },
    {
      "path": "src/notification/slack-webhook.ts",
      "start_line": 12,
      "end_line": 19,
      "symbol": "DEFAULT_TIMEOUT_MS",
      "kind": "const"
    }
  ],
  "shipped": {
    "date": "2026-04-04",
    "source": "roadmap issue #254",
    "issue": 254
  },
  "issues": [254],
  "confidence": "high",                              // "high" | "medium" | "low"
  "tier": "user-observable",                         // "user-observable" | "backend-surface"
  "changed_since_previous": null,                    // null OR { "kind": "added"|"modified", "diff": { ... } }
  "verified_at": "2026-05-26T13:15:00Z"              // last successful verification timestamp
}
```

## `changed_since_previous` shapes

```jsonc
// Added entry (new this run)
{ "kind": "added", "first_seen_sha": "a1b2c3d" }

// Modified entry — describes what changed vs previous JSON
{
  "kind": "modified",
  "fields_changed": ["observable_behaviors", "citations"],
  "diff": {
    "observable_behaviors": {
      "added":   ["Now also honors `Retry-After` header on 429."],
      "removed": ["Timeout fixed at 10 s."],
      "changed": [{ "from": "...", "to": "..." }]
    },
    "citations": {
      "added":   [{ "path": "...", "symbol": "...", "start_line": 200, "end_line": 240 }],
      "removed": []
    }
  }
}
```

## `removed_features[]` entry

Kept for one cycle so consumers can detect removal, then dropped on the next run.

```jsonc
{
  "id": "old-feature-id",
  "name": "Old feature name",
  "bundle": "...",
  "removed_in_sha": "a1b2c3d",
  "removed_at": "2026-05-26T13:15:00Z",
  "reason": "Replaced by <new-feature-id>." // human-written
}
```

## `coverage[]` entry

```jsonc
{
  "module": "src/orchestrator/",
  "feature_count": 24,
  "kind": "feature + plumbing",                     // or "plumbing only"
  "note": "Highest-density feature surface: polling, dispatch, retries, watchdog..."
}
```

## `needs_followup[]` entry

```jsonc
{
  "id": "pr-review-feedback-wiring",
  "title": "PR review feedback ingestion (#333) — wiring gap.",
  "body": "`fetchPRReviewFeedback` and `formatPRFeedbackForPrompt` are exported from `src/git/pr-review-ingester.ts` but have no in-tree caller outside the file at HEAD...",
  "question": "Is this an intentional deferral, or a missed wiring that should ship in a follow-up PR?",
  "first_raised_sha": "cbf423b",
  "last_seen_sha": "a1b2c3d",
  "status": "open",                                 // "open" | "resolved"
  "resolved_in_sha": null,
  "resolution": null
}
```

## `analyst_notes` record

```jsonc
{
  "readme_vs_code_drift": [
    { "bullet": "README.md badge: `v0.6.0`. HEAD: `v0.9.0-90-gcbf423b`.", "first_raised_sha": "cbf423b" }
  ],
  "net_new_undocumented": [
    { "bullet": "Nightly CI failure issue automation — `src/linear/nightly-failures.ts`...", "first_raised_sha": "cbf423b" }
  ],
  "wiring_gaps": [
    { "bullet": "PR review feedback #333 — shipped per roadmap but not wired to retry path.", "first_raised_sha": "cbf423b" }
  ],
  "bundle_fit_decisions": [
    { "bullet": "Persistence / State (bundle #3) vs. Persistence (bundle #11) split: kept as task brief specified.", "first_raised_sha": "cbf423b" }
  ],
  "missing_worth_investigation": [
    { "bullet": "Cloudflare Tunnel integration — referenced in README but no in-tree code.", "first_raised_sha": "cbf423b" }
  ]
}
```

## Validation rules (enforced by `scripts/validate_json.py`)

- `schema_version` must equal `"1.0"` or `"1.1"`.
- `commit_sha` is 40 hex chars; `previous_commit_sha` is 40 hex chars OR `null`.
- Every `features[].id` is unique and matches `^[a-z0-9-]+$`.
- Every `features[].bundle` is in the top-level `bundles[]` list.
- Every `features[]` has ≥ 2 entries in `citations[]`.
- Every `citations[].path` must be a real file in the **source repo** working tree. The validator auto-resolves the source repo from `source_repo.local_path` in the payload; override with `--source-repo <path>` if needed. (On v1.0 payloads without `source_repo`, falls back to `--source-repo` or current dir.)
- Every `citations[].start_line` ≤ `end_line`, both positive integers.
- `summary.total` equals `len(features)`.
- `summary.by_bundle` keys exactly equal the set of `bundle` values used in `features[]`.

## Additional checks (enforced by `scripts/fact_check.py`)

- For every backtick-wrapped token in `observable_behaviors` that looks like a constant identifier (matches `^[A-Z_][A-Z0-9_]*$`) or an `IDENT = value` assignment, the IDENT must `grep -F` find inside one of the entry's cited line ranges. Catches hallucinated constants.
- For every `citations[].symbol`, the symbol name must appear at least once inside the file at any line. (Stronger checks — that it appears within `start_line..end_line` — are warnings, not errors, because line ranges can drift.)
- Exit 0 = fact-check passes. Exit 1 = hard fail. Exit 2 = warnings only (with `--strict`, warnings escalate to fail).
