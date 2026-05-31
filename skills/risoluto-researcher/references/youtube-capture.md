# YouTube capture (researcher Step 2b)

Read this only when `/risoluto-researcher` is capturing a YouTube video — `source-type` is `video`. Today it captures **one video per supplied link** (`yt-dlp`); playlist / channel sweeps are planned extensions.

Uses [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) directly (not the `yt-dlp-mcp` wrapper): yt-dlp scrapes the watch page, so there is **no API key and no login** — the opposite of the X/Reddit paths, which need session cookies. We shell out to the CLI (rather than the MCP server) to keep this consistent with the other capture scripts: one `.mjs` that orchestrates the tool, downloads artifacts, and delegates the schema-valid write to `research.mjs`. A node script can't call MCP tools anyway.

Disciplines through the step:

- **Transcript, then clean it.** The script pulls the best English subtitle track and strips it to raw prose; the **LLM layer rewrites it into a clean transcript, in English** — translating when the source language isn't English. Captions are the raw material, not the finished artifact (§2).
- **Capture the whole information surface.** Title, full description, channel details + statistics, duration, view/like/comment counts, tags, categories, and chapters — comprehensive, not a blurb (§3).
- **Every description link is a discovery candidate.** External links become follow-on targets (§4).
- **Fail soft.** No captions, an age-gated/private video, or a dead thumbnail is a skip-and-note, never a hard stop (§6).

## §0 — Conditional precondition: `yt-dlp`

Not a global gate — non-video captures never reach it. No auth, no key.

```bash
pacman -S yt-dlp        # or: uv tool install yt-dlp / pipx install yt-dlp
yt-dlp --version        # confirm it runs
```

yt-dlp tracks YouTube changes closely; if extraction breaks, upgrade first (`yt-dlp -U` / reinstall) — a stale build is the usual cause.

## §1 — Capture a video

```bash
node skills/risoluto-researcher/scripts/youtube-capture.mjs --video "https://www.youtube.com/watch?v=<id>"
node skills/risoluto-researcher/scripts/youtube-capture.mjs --video <id> --dry-run   # safe preview
```

| Flag            | Default     | Effect                                                                     |
| --------------- | ----------- | -------------------------------------------------------------------------- |
| `--video`       | —           | watch / `youtu.be` / `shorts` URL or bare 11-char id (required)            |
| `--sub-lang`    | auto-chosen | force a subtitle language (overrides the manual>auto>original choice)      |
| `--no-subs`     | off         | skip the transcript fetch                                                  |
| `--no-media`    | off         | skip the thumbnail download                                                |
| `--force`       | off         | overwrite an already-captured source                                       |
| `--dry-run`     | off         | print the plan; write nothing, download nothing                            |
| `--from-json`   | —           | read a saved `yt-dlp -J` info dump instead of calling yt-dlp (resume/test) |
| `--target-slug` | `<channel>` | override the target (defaults to the channel name)                         |

**What it produces** under `research/targets/<channel>/`:

```
sources/video-<id>.md       # channel + stats, description, chapters, references, transcript
media/video-<id>/0.<ext>    # video thumbnail
discovery-queue.md          # description links worth their own capture
```

The video is written via `research.mjs` (`--source-type video`), so the source frontmatter passes `validate:research`. The target is the **channel** (a tweet groups under its author, a Reddit post under its community, a video under its channel).

Then the agent's judgment layer: clean the transcript (§2), fill `## Why this matters for Risoluto`, promote discovery-queue rows, and run the normal Step 5 candidate-feature extraction + dedup.

## §2 — Transcript: best English track, then LLM-cleaned

`chooseSubtitleTrack` picks the track from the info dump in priority order: **manual English → auto-generated English → the video's original language** (flagged for translation). The script downloads that one track as WebVTT and `cleanVtt` strips it to flowing text — dropping the `WEBVTT`/`Kind`/`Language` headers, cue indices, `-->` timestamp lines, and inline `<...>` timing tags, then collapsing the "rolling" duplication of auto-captions (each cue repeats the previous line plus a few new words).

That output is **raw**, and the `## Transcript` section says so when it came from auto-captions or a non-English source. The agent then does the LLM step the script can't:

- **Rewrite it clean** — punctuation, paragraphs, speaker turns where obvious. Auto-captions especially arrive as one long lowercase run.
- **Translate to English** when the header marks the track as non-English (`agent: translate to English`). Keep the meaning; don't summarize — this is a transcript, not a digest.

Replace the raw transcript in place with the cleaned version. If you summarize anything, do it under `## Why this matters for Risoluto`, not in the transcript body.

## §3 — Video information + channel statistics

Pulled from the single `yt-dlp -J` dump (one request, no extra calls):

- **Channel** — name, handle (`uploader_id`), URL, and subscriber count (`channel_follower_count`).
- **Stats** — views, likes, comments, duration, publish date; plus categories and the first ~20 tags.
- **Chapters** — the creator's chapter markers with timestamps, when present.
- **Description** — captured in full (it often carries the real context: links, credits, corrections).

Deeper channel statistics (total videos, lifetime views) would need a separate channel fetch and are intentionally skipped for now — the per-video dump already answers "whose channel, how big, how watched."

## §4 — References → discovery queue

Every external `https://` link in the description is extracted, de-duplicated, classified by destination (`github.com`→`repo`, `youtube`→`video`, `arxiv`→`paper`, `reddit`→`reddit`, `x.com`→`x`, else `article`), given a suggested slug, and written to `discovery-queue.md`. YouTube's own watch/channel/handle links are dropped (they are navigation, not follow-on targets).

Limit: links shown _inside_ the video (cards, end screens, on-screen text) are not in the metadata and are not captured — only description links are. If a video clearly points somewhere the description omits, add it to the queue by hand.

## §5 — Recall

A single video is a closed set: its metadata plus one transcript. The summary line is the recall signal — it reports the transcript size and which track was used (`<lang> manual/auto`), so a later reader can see whether a clean human transcript or a rough auto-caption was captured, and whether translation was needed. The one place recall is best-effort: videos with **no captions at all** (the transcript section says `_(no subtitles available)_`) and in-video links the description omits (§4).

## §6 — Fail soft

- **No subtitles** — the source is still written with full info; the transcript section notes none were available.
- **Private / age-gated / members-only / geo-blocked** — yt-dlp errors out; report it and move on (some age-gated videos need `--cookies-from-browser`, which we don't wire in by default).
- **Extraction broken after a YouTube change** — upgrade yt-dlp (`yt-dlp -U`) and retry before assuming the video is the problem.
- **Thumbnail `404`** — logged, skipped; the source is still written without the image.
- **`research.mjs` write fails** — logged; fix the reported frontmatter issue and re-run with `--force`.
