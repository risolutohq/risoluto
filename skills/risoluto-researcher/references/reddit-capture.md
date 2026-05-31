# Reddit capture (researcher Step 2b)

Read this only when `/risoluto-researcher` is capturing Reddit content — `source-type` is `reddit`. Today it captures **one thread per manually-supplied link** (`rdt read`); bulk modes (`saved`, subreddit top-N, search) are planned extensions.

Uses [`public-clis/rdt-cli`](https://github.com/public-clis/rdt-cli) — the Reddit sibling of `twitter-cli` (same `{ ok, schema_version, data, error }` envelope, same cookie + Chrome-TLS-fingerprint approach). This matters: **Reddit disabled unauthenticated `.json` access** — direct requests now return `403`, and the working path is session cookies + a real TLS fingerprint, which is exactly what rdt-cli does. The old "append `.json`, no auth" trick is dead.

Disciplines through the step:

- **Capture everything.** A pasted thread is captured whole — full post body, all media, and the **entire comment tree sorted by top**. Reddit's comment tree is genuinely the post's replies (no recommendation pollution like X), so there is no reply-vs-recommendation filter and no top-N cap.
- **Every reference is a discovery candidate.** External links, cross-subreddit (`r/…`) and user (`u/…`) mentions become follow-on targets (§4).
- **Fail soft.** An auth error or a dead media URL is a skip-and-note, never a hard stop (§6).

## §0 — Conditional precondition: `rdt-cli` + login

Not a global gate — non-Reddit captures never reach it.

```bash
uv tool install rdt-cli      # or: pipx install rdt-cli
rdt login                    # extract browser cookies (Chrome / Firefox / Edge / Brave)
rdt status                   # confirm authenticated
```

Cookies last ~7 days, then rdt auto-refreshes from the browser. A `not_authenticated`/`forbidden` error in the envelope means re-run `rdt login`.

## §1 — Capture a thread

```bash
node skills/risoluto-researcher/scripts/reddit-capture.mjs --post "https://www.reddit.com/r/<sub>/comments/<id>/<slug>/"
node skills/risoluto-researcher/scripts/reddit-capture.mjs --post <id> --dry-run   # safe preview
```

| Flag             | Default | Effect                                                                       |
| ---------------- | ------- | ---------------------------------------------------------------------------- |
| `--post`         | —       | thread URL or bare post id (required)                                        |
| `--comment-sort` | `top`   | comment sort passed to `rdt read -s` (`top`/`best`/`new`/`controversial`)    |
| `--no-media`     | off     | skip media download                                                          |
| `--force`        | off     | overwrite an already-captured source                                         |
| `--dry-run`      | off     | print the plan; write nothing, download nothing                              |
| `--from-json`    | —       | read a saved `rdt read --json` envelope instead of calling rdt (resume/test) |
| `--target-slug`  | `<sub>` | override the target (defaults to the subreddit name)                         |

**What it produces** under `research/targets/<subreddit>/`:

```
sources/post-<id>.md      # post body, media links, references, the full comment tree
media/post-<id>/0.<ext>   # post media, if the URL is an image/video
discovery-queue.md        # links / r-subreddits / u-users worth their own capture
```

The thread is written via `research.mjs` (`--source-type reddit`), so the source frontmatter passes `validate:research`. The target is the **subreddit** (a tweet groups under its author; a Reddit post groups under its community).

Then the agent's judgment layer: fill `## Why this matters for Risoluto`, promote discovery-queue rows, and run the normal Step 5 candidate-feature extraction + dedup.

## §2 — Comments: everything, sorted by top

`rdt read <id> -s top --expand-more` returns the comment tree already top-sorted, with extra "more comments" expanded. `renderComments` walks the tree depth-first, preserving that order, and emits one indented bullet per comment (`u/author (score) — body`) — nesting shown by indentation. Nothing is dropped: removed/deleted bodies stay as markers so the thread shape is faithful. The header reports the full count (`## Comments (N, sorted by top)`).

## §3 — Media

Reddit's post object has no media array — media is the post `url` itself when it points at an image/video host (`i.redd.it`, `v.redd.it`, `preview.redd.it`, `i.imgur.com`, or a `.jpg/.png/.gif/.mp4/.webp` URL). That file is downloaded to `media/post-<id>/`. For a **link post** (non-self, non-media URL), the `url` is recorded as an external reference (§4) instead. Caveat: `v.redd.it` videos are DASH-segmented, so a single download may not yield a playable file — it is best-effort and logged on failure.

## §4 — References → discovery queue

Scanned from the post selftext + every comment body: external `https://` links, `r/<subreddit>` mentions, and `u/<user>` mentions. Each is deduped, classified by destination (`github.com`→`repo`, `youtube`→`video`, `arxiv`→`paper`, other-reddit→`reddit`, else `article`), given a suggested slug, and written to `discovery-queue.md`. Reddit _media_ URLs are excluded (they are content, not follow-on targets); reddit _thread_ links are kept (another thread worth capturing).

## §5 — Recall

A single thread is a closed set: the post plus its full comment tree. The summary line is the recall signal — it reports the total comment count captured (`N comments`), so a later reader sees the thread was taken whole, not sampled. `--expand-more` covers the top-level "more comments"; very deep buried chains may still hide replies, which is the one place recall is best-effort.

## §6 — Fail soft

- **`not_authenticated` / `forbidden`** — `rdt login` to refresh cookies; the run stops only if the read itself can't authenticate.
- **`rate_limited`** — rdt already adds jitter/backoff; if it still fails, re-run later.
- **Media `404` / DASH video** — logged, skipped; the source is still written without the file.
- **`research.mjs` write fails** — logged; fix the reported frontmatter issue and re-run with `--force`.
