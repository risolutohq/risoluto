# Feature entry template

Every feature in the spine has the same six-block shape — in both the markdown and the JSON. This file is the source of truth for that shape. When you write a new entry or edit an existing one, mirror it.

## Markdown form

```markdown
### {{ name }}

- **Description:** {{ one sentence on intent / what the operator sees }}
- **How it works:** {{ one paragraph on the mechanism, naming the principal class/function with backticks }}
- **Observable behaviors:**
  - {{ behavior 1 — quote constants verbatim from code in backticks }}
  - {{ behavior 2 }}
  - {{ behavior 3 }}
- **Evidence:**
  - Source: `{{ path }}:L{{ start }}-L{{ end }}` — `{{ symbol }}` ({{ class | function | const | interface }})
  - Source: `{{ path }}:L{{ start }}-L{{ end }}` — `{{ symbol }}` ({{ kind }})
- **Shipped in:** {{ "Shipped YYYY-MM-DD (roadmap issue #NNN)" | "default branch @ YYYY-MM-DD (`<sha>`)" }}
- **Related GitHub issues:** {{ "#NNN, #MMM" | "—" }}
```

## JSON form

Maps 1:1 to the markdown. See `references/json-schema.md` for the full schema.

```json
{
  "id": "slack-block-kit-webhook",
  "bundle": "Notifications, Chat & Triggers",
  "name": "Slack Block Kit webhook channel",
  "description": "Dedicated Slack delivery adapter that formats notifications as Block Kit payloads and POSTs to the configured Slack incoming-webhook URL, honoring per-event severity and verbosity gates.",
  "how_it_works": "`SlackWebhookChannel.notify` serializes the event into a `{ text, attachments[].color, blocks[] }` payload, attaches the severity colour, and dispatches via `fetch` with a 10 s `AbortController` timeout.",
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
  "shipped": { "date": "2026-04-04", "source": "roadmap issue #254", "issue": 254 },
  "issues": [254],
  "confidence": "high",
  "tier": "user-observable",
  "changed_since_previous": null,
  "verified_at": "2026-05-26T13:15:00Z"
}
```

## Tombstone form (removed features)

When a feature's implementation disappears from the source repo, it is **not** deleted — its full record moves from `features[]` to `removed_features[]` (so the validators, which only walk `features[]`, never trip on its now-dead citations) and it renders in-body inside its original bundle with a removal marker. This keeps the spine a durable research memory: a researcher comparing a peer's capability can see Risoluto built this and deliberately removed it, so it isn't re-proposed.

```markdown
### {{ name }} ⚠️ Removed in {{ git describe / sha }} ({{ removed_at date }})

> **REMOVED {{ date }} (`{{ removed_in_sha }}`):** {{ one–two sentence reason — what replaced it, or why it was dropped }}

- **Description:** {{ original body, retained verbatim }}
- **How it works:** {{ retained }}
- **Observable behaviors:**
  - {{ retained }}
- **Evidence:**
  - Source: `{{ path }}:L{{ start }}-L{{ end }}` — `{{ symbol }}` ({{ kind }}) {{ — now points at deleted code; that is expected for a tombstone }}
- **Shipped in:** {{ retained }}
```

Rules:

1. The body below the marker is **frozen** — keep it as it last read. Don't re-verify or "repair" citations that now point at deleted code; recording what _was_ is the whole point.
2. Tombstones are **persistent** — never dropped on a later run.
3. They render at the **end of their bundle section**, after the active entries, so each bundle still reads "what ships today" first.
4. In `## Changed since last spine`, the Removed subsection links to the tombstone (the anchor resolves because the body is retained).

## Style rules — non-negotiable

1. **One sentence for `description`.** If you need two, the second one belongs in `how_it_works` or as a behavior bullet.
2. **`how_it_works` names the principal symbol.** Backtick the class/function name. The mechanism should be one paragraph, not three.
3. **Behaviors are quotes from the code, not paraphrases.** If the code says `DEFAULT_TIMEOUT_MS = 10_000`, write `Timeout: \`DEFAULT_TIMEOUT_MS = 10_000\``. The whole point is falsifiability — a reader can grep the literal.
4. **At least 2 citations.** One citation is insufficient even if the feature lives in a single file — cite the entry point AND a key supporting symbol (e.g., the constant or the schema or the interface).
5. **Citation kind matters.** Annotate `class | function | const | interface | type | enum` because it tells the reader what shape of code they're jumping to.
6. **Issue numbers are bare integers in JSON, `#NNN` in markdown.** Don't mix.
7. **`shipped.source` is one of:** `"roadmap issue #NNN"` (when an issue closure documents the ship date) OR `"default branch @ <sha>"` (when the feature shipped directly to master without an issue closure). Match the spine's existing pattern.

## Naming the entry

- The H3 heading text (markdown) and the `name` field (JSON) must match exactly.
- Use sentence case: "Slack Block Kit webhook channel", not "Slack block kit webhook channel" or "SLACK BLOCK KIT WEBHOOK CHANNEL".
- Don't pun. The name is searchable; "Notifications with style" is worse than "Slack Block Kit webhook channel".
- If you rename a feature between runs, the `id` stays the same (it's the stable key); only `name` updates. Note the rename in the commit message body.

## Tier rule

- `tier: "user-observable"` if an operator interacts with the feature directly (dashboard control, CLI flag, HTTP endpoint, notification they receive).
- `tier: "backend-surface"` if the feature is a server-side mechanism that affects observable behavior but isn't directly poked by a human (orchestrator dispatch logic, retry classification, schema migrations, encryption envelope).
- When in doubt, prefer `user-observable` — the bar is "could an operator file a bug about this?".

## Confidence rule

- `confidence: "high"` if the entry has ≥2 cited file ranges AND every quoted constant has been verified against the code at the current SHA.
- `confidence: "medium"` if the entry exists in code but you're missing one citation or one quoted behavior couldn't be verified.
- `confidence: "low"` if the feature is implied by docs/issues but the wiring is partial or you couldn't locate the principal symbol. Low-confidence entries also surface in `## Needs follow-up`.
