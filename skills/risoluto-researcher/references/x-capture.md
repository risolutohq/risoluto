# X / Twitter capture (researcher Step 2b)

Read this only when `/risoluto-researcher` is capturing X/Twitter content — `source-type` is `x`. Two entry modes:

- **Bulk bookmarks** (the common case) — harvest your whole bookmark list via `scripts/x-bookmarks.mjs`.
- **Single tweet / thread** — capture one pasted `x.com/<user>/status/<id>` URL inline.

Both use [`public-clis/twitter-cli`](https://github.com/public-clis/twitter-cli) — a no-API-key tool that reads X over browser-cookie auth and emits an agent-friendly `{ ok, data, pagination }` JSON envelope. Three disciplines run through the step (mirroring `github-capture.md`):

- **Full content, not an excerpt.** Capture the whole tweet text, all media, and the real engagement metrics — not a 200-word skim.
- **Rank comments, don't dump them.** Replies are mostly noise. Keep the few useful ones by engagement score; drop the rest. See §3.
- **Every reference is a discovery candidate.** Links, quoted tweets, and @mentions become follow-on capture targets — that is how bookmark capture _compounds_ into more research. See §4.
- **Fail soft.** An auth error, a rate-limit, or a dead media URL is a skip-and-note, never a hard stop. See §6.

## §0 — Conditional precondition: `twitter-cli` + auth

This is the only researcher path that needs `twitter-cli`. It is **not** a global precondition — non-X captures never reach it.

```bash
uv tool install twitter-cli            # or: pipx install twitter-cli
twitter --help                         # verify it is on PATH
```

Auth (priority order, no API keys):

1. Env vars: `TWITTER_AUTH_TOKEN` + `TWITTER_CT0`
2. Browser cookies (recommended): auto-extracted from Chrome/Arc/Edge/Firefox/Brave

A `401/403` from any command means auth failed — re-extract cookies or refresh the tokens.

> **ToS caveat:** twitter-cli reads via your logged-in cookies with anti-detection (TLS impersonation, timing jitter). That is technically against X's ToS and _could_ flag the account — low risk for read-only research, but it is your account. The sanctioned alternative is the official X API (`sferik/x-cli`) behind a paid tier.

## §1 — Mode A: bulk bookmarks

One command harvests every bookmark, downloads all media, ranks the useful replies on high-signal tweets, builds a discovery queue, and writes one schema-valid source file per bookmark by delegating to `research.mjs`:

```bash
node skills/risoluto-researcher/scripts/x-bookmarks.mjs            # capture everything
node skills/risoluto-researcher/scripts/x-bookmarks.mjs --limit 20 --dry-run   # safe first look
```

| Flag                     | Default       | Effect                                                                       |
| ------------------------ | ------------- | ---------------------------------------------------------------------------- |
| `--max`                  | `100`         | bookmarks per API page (pagination loops until exhausted)                    |
| `--limit`                | `0` (all)     | cap total bookmarks processed — use a small value for the first run          |
| `--comments-min-replies` | `5`           | only fetch + rank replies for tweets with at least this many replies         |
| `--comments-top`         | `5`           | keep this many top-ranked replies per tweet                                  |
| `--no-media`             | off           | skip media download (faster dry checks)                                      |
| `--force`                | off           | re-capture bookmarks whose source file already exists (otherwise skipped)    |
| `--dry-run`              | off           | print the plan; write nothing, fetch no comments, download no media          |
| `--from-json <file>`     | —             | read a saved bookmarks envelope instead of calling twitter-cli (resume/test) |
| `--target-slug`          | `x-bookmarks` | the staging target all bookmarks land under                                  |

**What it produces** under `research/targets/x-bookmarks/`:

```
sources/tweet-<id>.md     # one per bookmark: full text, metrics, media links, references, top replies
media/tweet-<id>/<n>.<ext># every photo/video/gif, downloaded
discovery-queue.md        # deduped follow-on targets (links / quoted / mentions), typed + slug-suggested
```

It is **resumable** — already-captured bookmarks are skipped, so a re-run only picks up new ones (use `--force` to redo). The closing stderr line is the recall signal (§5).

**Then the agent's judgment layer takes over** (the script captures facts; you extract meaning):

1. Open `discovery-queue.md`. For each high-value reference, run `/risoluto-researcher` on it with the suggested `source-type`/slug — repos go through `github-capture.md`, videos through `video-capture.md`, etc. Delete promoted rows.
2. For each source worth it, fill the `## Why this matters for Risoluto` TODO and run the normal Step 5 candidate-feature extraction + dedup against the roadmap and `RISOLUTO_FEATURES.md`.

## §2 — Mode B: single tweet / thread

A single pasted tweet URL is captured **turnkey** by the same script — pass `--tweet` instead of harvesting bookmarks. This is the path the router (SKILL.md Step 2b) lands on when `source-type` is `x` and the URL is one `status/<id>` link:

```bash
node skills/risoluto-researcher/scripts/x-bookmarks.mjs --tweet "https://x.com/<user>/status/<id>"
```

It fetches the tweet + its replies in one `twitter tweet` call and gives it the same treatment as one bookmark — full text, all media, engagement-ranked replies (with **no** `--comments-min-replies` gate, since you explicitly chose this tweet), references, and a discovery queue. The target defaults to the **author's handle** (a tweet by `@swyx` → `targets/swyx/`); override with `--target-slug`.

Under the hood it uses the twitter-cli commands below — run them directly only if you need raw output or the one case `--tweet` does not cover (an X _article_ URL):

```bash
twitter tweet "https://x.com/<user>/status/<id>" --json --full-text   # tweet + replies (what --tweet wraps)
twitter article "https://x.com/<user>/article/<id>" --markdown        # longform article → markdown
twitter user <handle> --json                                          # author bio / credibility
```

## §3 — Useful replies, not noise

First, a **recommendation filter**: a `twitter tweet <id>` payload mixes the real replies with "discover more" / related tweets (which can carry enormous engagement and would otherwise dominate the ranking — a viral unrelated tweet is not a reply). twitter-cli's serialized tweet object has no `in_reply_to` field, so genuine replies are identified by the X convention that a reply **@-mentions the root author**. Items that don't address the author are dropped before ranking (see `isReplyTo`). Trade-off: a rare real reply with its leading @mention stripped can be lost — acceptable next to letting recommendations win.

Survivors are ranked by the same weighted engagement score twitter-cli uses internally (`filter.py`): `likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views)×0.5`. On top of that, a reply is dropped as **noise** if, after stripping @mentions / links / emoji / punctuation, it has fewer than ~15 characters of real text, or if it is promoted. Keep the top `--comments-top`. This is why bulk comment-fetch is gated on `--comments-min-replies`: a tweet with 2 replies has no signal worth a second network round-trip (single `--tweet` capture skips the gate — you chose that tweet).

## §4 — References → discovery queue

Every tweet carries follow-on leads: `urls[]` (external links), `quotedTweet` (a referenced post), and `@mentions` in the body. The script dedupes them across all bookmarks, classifies each by destination (`github.com`→`repo`, `youtube`→`video`, `arxiv`→`paper`, `x.com`→`x`, else `article`), suggests a target slug, and records how many bookmarks referenced it. High-reference-count rows are the strongest "capture this next" signals.

## §5 — Recall reconciliation

The closed set is **your bookmark list** — recall is checkable. The script's final stderr line reports it:

```
x-bookmarks: N bookmarks → W sources written, S already-captured (skipped), M media files,
             comments ranked for K high-signal tweets, D discovery candidates
```

`W + S` should equal `N`; a shortfall means some bookmarks failed to write (check the per-tweet error lines). Unlike a repo's code surface, X has no "backend mechanics" blind spot here — the bookmark list is fully enumerable.

## §6 — Fail soft (error handling)

- **`401/403`** — auth failed; re-extract cookies / refresh tokens. The whole run stops only if the _first_ call fails (no auth at all).
- **Rate limited** — twitter-cli already adds timing jitter; if a page still fails, the harvest stops with what it has. Re-run later (it resumes).
- **Media `404` / dead URL** — logged, skipped; the source is still written without that file.
- **Comment fetch fails for one tweet** — logged, skipped; the bookmark's source is kept (just without replies).
- **One bookmark's `research.mjs` write fails** — logged, the batch continues. Don't restart the whole harvest for one bad tweet.
