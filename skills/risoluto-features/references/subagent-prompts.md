# Subagent prompt templates

The risoluto-features skill uses map-reduce: per-module subagents do source reading and feature extraction in parallel so the main agent's context stays compact. This file holds the **prompt templates** the main agent fills in and passes to each subagent.

Two templates:
- **`extract`** — used on cold start and for net-new modules. Subagent reads source, returns feature records.
- **`verify`** — used on incremental updates. Subagent re-checks a batch of existing entries against current source.

Both expect `subagent_type: "general-purpose"`.

---

## `extract` template

Fill in the `<<>>` placeholders, then pass as the `prompt` field to the Agent tool.

```text
You are extracting feature records for the Risoluto Feature Spine from ONE module of the risoluto source code. You return JSON only — no commentary, no markdown wrapping.

Context:
- Source repo: risolutohq/risoluto at SHA <<SOURCE_SHA>> (date <<SOURCE_DATE>>)
- Module to scan: <<MODULE_PATH_ABS>>          (absolute path on this machine)
- Source repo root: <<SOURCE_DIR_ABS>>         (use for cross-module citations only)
- Closed roadmap issues (cross-reference): <<CLOSED_ISSUES_JSON_PATH>>
- Output JSON schema reference: /home/oruc/.claude/skills/risoluto-features/references/json-schema.md
- Feature entry shape reference: /home/oruc/.claude/skills/risoluto-features/references/feature-entry-template.md
- Bundle assignment rules: /home/oruc/.claude/skills/risoluto-features/references/bundle-rules.md

What counts as a feature for this spine:
- Tier "user-observable": an operator interacts with it directly (CLI flag, HTTP endpoint, notification they receive, dashboard control).
- Tier "backend-surface": a server-side mechanism that affects observable behavior but isn't directly poked by a human (orchestrator dispatch logic, retry classification, schema migrations).
- DROP: pure plumbing types (interfaces, ports), test files, internal helpers without observable effect.

For each feature you find in <<MODULE_PATH_ABS>>, produce a JSON record with:
- id: stable kebab-case, derived from the principal symbol (e.g., "slack-block-kit-webhook")
- name: H3-shaped title, sentence case
- description: ONE sentence on intent / what an operator sees
- how_it_works: ONE paragraph naming the principal class/function (backtick the symbol name)
- observable_behaviors: 3–6 bullets. Quote constants and enum values VERBATIM from the code in backticks.
- citations: at least 2 entries, each {path, start_line, end_line, symbol, kind}.
  - path is RELATIVE to source repo root (e.g., "src/notification/slack-webhook.ts")
  - Open the file. Count lines. Don't estimate.
  - kind ∈ {"class", "function", "const", "interface", "type", "enum"}
  - symbol is the ACTUAL identifier (e.g., "SlackWebhookChannel"), not an English phrase ("the slack channel class"). NEVER use slashes or English; if you need to cite multiple symbols, write multiple citation entries.
- shipped: {date: "<<SOURCE_DATE>>", source: "default branch @ <<SOURCE_SHA_SHORT>>", issue: <int or null>}
- issues: array of issue numbers (integers). Cross-reference <<CLOSED_ISSUES_JSON_PATH>> for matching titles; leave empty if no clear match.
- tier: "user-observable" | "backend-surface"
- confidence: "high" only if you verified ≥2 citations and every quoted constant grep-matches.
- bundle: leave empty string ""  — the main agent assigns bundles after merge.
- changed_since_previous: null
- verified_at: current ISO-8601 UTC timestamp

CRITICAL — anti-hallucination rules:
1. Every backtick-wrapped constant in observable_behaviors MUST be `grep -F`-findable in the cited file within the cited line range. If you can't find it there, don't quote it.
2. Every citation symbol MUST exist verbatim in the cited file. Open the file and confirm.
3. Issue numbers MUST come from the closed-issues JSON. Do NOT invent #NNN refs.
4. If you can't produce 2 credible citations for a feature, DROP it — don't pad.
5. Don't fabricate features from training-data familiarity. If it isn't in <<MODULE_PATH_ABS>>'s code, it doesn't go in your output.

Output format:
Return a single JSON array. No markdown wrapping. No commentary. No "here are the features" preamble. Just:

[
  { ...feature record... },
  { ...feature record... }
]

If the module has no features worth recording (pure plumbing), return: []

Word limit on description + how_it_works combined: ~80 words. Keep observable_behaviors bullets terse — one line each.
```

---

## `verify` template

Fill in the `<<>>` placeholders. The batch is passed as a JSON array of features to re-verify.

```text
You are re-verifying a batch of existing Risoluto Feature Spine entries against the current source code. You return JSON only.

Context:
- Source repo: risolutohq/risoluto at SHA <<SOURCE_SHA>> (date <<SOURCE_DATE>>)
- Source repo root: <<SOURCE_DIR_ABS>>
- Verification checklist: /home/oruc/.claude/skills/risoluto-features/references/verification-checklist.md

Batch to verify (JSON array of feature records):
<<FEATURES_JSON>>

For each feature in the batch, walk the verification checklist:

1. Citation files exist? `test -f <<SOURCE_DIR_ABS>>/<path>` for each citation.
2. Symbol still defined in the file? Open the file, search for the symbol name.
3. Line ranges still bracket the symbol? Re-derive start_line/end_line if the symbol moved within the file.
4. Quoted constants still match? For every backtick-wrapped IDENT or IDENT=value in observable_behaviors, grep the cited file. If the value changed, that's a MATERIAL change.
5. Issue refs still valid? Use `gh api repos/risolutohq/risoluto/issues/<N> --jq '{state, title}'` to confirm.

For each feature, output a status:
- "unchanged" — all checks pass; just bump verified_at to current ISO-8601 UTC timestamp
- "drifted" — citation line ranges moved silently (symbol/file/behavior unchanged); update lines, no other changes
- "modified" — observable_behaviors or quoted constants changed in a way that affects the contract; populate changed_since_previous with diff details
- "removed" — citation files all gone AND symbol can't be relocated; mark for removal

Output format — return a JSON array of update objects (one per input feature, in the same order):

[
  {
    "id": "feature-id",
    "status": "unchanged" | "drifted" | "modified" | "removed",
    "updated_feature": { ...full updated feature record... } | null,
    "removal_reason": "..." | null,
    "notes": "..." | null
  },
  ...
]

If status is "removed", set updated_feature to null and populate removal_reason.
If status is "modified", populate changed_since_previous.diff inside updated_feature.
If status is "unchanged" or "drifted", updated_feature contains the full feature with line ranges re-derived as needed.

Don't hallucinate. If you can't tell whether a check passed (e.g., issue API rate-limited), output status "unchanged" and add a `notes` line explaining what you couldn't verify.

Word budget: keep `notes` under 30 words per feature.
```

---

## How the main agent invokes these

```javascript
// Cold start: spawn extract per module, in parallel
const modules = ["src/notification", "src/orchestrator", /* ... */];
const extractPrompts = modules.map(m => extractTemplate
  .replace("<<MODULE_PATH_ABS>>", `${SOURCE_DIR_ABS}/${m}`)
  .replace("<<SOURCE_DIR_ABS>>", SOURCE_DIR_ABS)
  .replace("<<SOURCE_SHA>>", SOURCE_SHA)
  .replace("<<SOURCE_SHA_SHORT>>", SOURCE_SHA.slice(0, 7))
  .replace("<<SOURCE_DATE>>", SOURCE_DATE)
  .replace("<<CLOSED_ISSUES_JSON_PATH>>", "/tmp/risoluto-closed-issues.json")
);
// One Agent call per prompt, all in the same message → parallel execution
```

```javascript
// Incremental: chunk existing features into batches of ~15
const batches = chunkArray(existingJson.features, 15);
const verifyPrompts = batches.map(batch => verifyTemplate
  .replace("<<FEATURES_JSON>>", JSON.stringify(batch))
  .replace("<<SOURCE_DIR_ABS>>", SOURCE_DIR_ABS)
  .replace("<<SOURCE_SHA>>", SOURCE_SHA)
  .replace("<<SOURCE_DATE>>", SOURCE_DATE)
);
```

The main agent never reads `.ts` files. It assembles inputs, dispatches subagents, merges JSON outputs, runs the validation scripts, and presents the commit message.

## What to do if a subagent returns garbage

Common failures and recovery:

| Failure | Cause | Recovery |
|---|---|---|
| Subagent returns markdown-wrapped JSON | Forgot the "no markdown" instruction | Strip ```` ```json ```` fences before parsing; if persistent, re-spawn |
| JSON parse error | Trailing comma, comment, etc. | Re-spawn with explicit "valid JSON only — no JS comments, no trailing commas" |
| Feature with <2 citations | Subagent padded | Drop the offending features; note in analyst_notes |
| Citation symbol is an English phrase ("the auth helper") | Subagent didn't grep | Drop the offending citations; note in analyst_notes — these would fail fact_check anyway |
| Subagent returns an empty array | Plumbing-only module | Accept; record the module in Coverage manifest with kind="plumbing only" |
| Timeout / no response | Subagent stuck | Re-spawn just that module |

Don't restart the whole pipeline because one subagent failed. Just re-spawn the bad one.
