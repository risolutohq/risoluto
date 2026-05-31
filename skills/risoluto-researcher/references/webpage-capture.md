# Web page capture (researcher Step 2b)

Read this only when `/risoluto-researcher` is capturing a generic web page — `source-type` is `article`. Captures **one page per URL** as clean structured markdown.

Renders the page in a real Chromium via [`browser-harness`](https://github.com/browser-use/browser-harness) (CDP), then converts the rendered DOM to markdown with a vendored [Turndown](https://github.com/mixmark-io/turndown). The conversion is **deterministic** (no per-page LLM cost) — the LLM judgment happens later, at the candidate-feature layer, same as every other medium.

Why a real browser instead of fetch + readability: the medium is "any web page", including the JavaScript-rendered competitor SPAs we track as `peer`. A real Chrome materialises that content before extraction. browser-harness has no markdown extractor of its own, so the converter (`scripts/vendor/turndown.js`) is injected into the page.

Disciplines through the step:

- **Render, then convert.** browser-harness loads the page in Chromium; a heuristic content-prune + Turndown produce the markdown (§2). research.mjs writes the title as the H1, so the page's own leading title block is stripped to avoid a duplicate (§2).
- **Every cross-site link is a discovery candidate.** External links (different host than the page) become follow-on targets; internal navigation is ignored (§4).
- **Fail soft.** A failed render, a thin extraction, or a bot wall is a report-and-skip, never a silent empty source (§5, §6).

## §0 — Conditional precondition: `browser-harness` + a Chrome on the CDP port

Not a global gate — non-`article` captures never reach it. No API key for local capture.

```bash
browser-harness --doctor      # must show: chrome running / daemon alive / active browser connections ≥ 1
```

browser-harness connects to a Chrome/Chromium exposing the DevTools protocol. Two ways (see the install's `install.md`):

- **Way 1 — your real browser (sticky, low-friction):** in your Chrome, open `chrome://inspect/#remote-debugging` and tick "Allow remote debugging for this browser instance" (persists per-profile). First attach on Chrome 144+ shows a one-time "Allow" popup.
- **Way 2 — a dedicated automation browser (no popups, unattended):** launch Chromium yourself and point the harness at it:
  ```bash
  chromium --remote-debugging-port=9333 --user-data-dir="$HOME/.cache/browser-harness-chrome" --headless=new &
  # then set BU_CDP_URL=http://127.0.0.1:9333 (browser-harness reads it from its .env)
  ```

If `--doctor` shows `active browser connections — 0`, the browser on the CDP port isn't running — start it (Way 1 or Way 2) before capturing.

## §1 — Capture a page

```bash
node skills/risoluto-researcher/scripts/webpage-capture.mjs --url "https://..."
node skills/risoluto-researcher/scripts/webpage-capture.mjs --url "https://..." --dry-run   # renders, writes nothing
```

| Flag            | Default     | Effect                                                                 |
| --------------- | ----------- | ---------------------------------------------------------------------- |
| `--url`         | —           | the page URL (required)                                                |
| `--target-slug` | host brand  | override the target (defaults to the host's second-level domain)       |
| `--source-slug` | path/title  | override the source id (defaults to the last path segment, else title) |
| `--category`    | `reference` | `peer` \| `reference` \| `adjacent`                                    |
| `--wait`        | `1.5`       | extra settle seconds after load (raise for slow SPAs)                  |
| `--force`       | off         | overwrite an already-captured source                                   |
| `--dry-run`     | off         | render + report; write nothing                                         |
| `--from-json`   | —           | read a saved BH_RESULT payload instead of driving the browser (test)   |

**What it produces** under `research/targets/<host-brand>/`:

```
sources/<source-slug>.md   # provenance line, the converted markdown, references, why-it-matters
discovery-queue.md         # cross-site links worth their own capture
```

Written via `research.mjs` (`--source-type article`), so the frontmatter passes `validate:research`. The target is the **host brand** (a tweet groups under its author, a video under its channel, a page under its site).

## §2 — How the markdown is made

The in-page extractor (1) picks the content root (`main`, `article`, `[role=main]`, else `body`), (2) removes non-content nodes (`script`/`style`/`svg`/`iframe`/`nav`/`header`/`footer`/`aside`/`form`/`button` + `[aria-hidden]`/banner/navigation/contentinfo roles), (3) absolutises `href`/`src` so links and images keep real URLs, then (4) runs `TurndownService` (atx headings, fenced code, `-` bullets). The result is clean markdown — headings, lists, links, images, code blocks, blockquotes all preserved.

research.mjs writes the page title as the source H1, so `stripLeadingTitle` drops the page's own leading title block (any breadcrumb/logo cruft plus the first H1 if it sits in the lead) to avoid a duplicate heading. A late H1 deeper in the page is a real section heading and is kept.

## §3 — Content-selection limits (no Readability)

The prune is heuristic, not a full readability pass, so two kinds of cruft can survive: a newsletter/subscribe blurb or related-links strip that lives _inside_ the content container rather than in a `<footer>`. This is acceptable — the agent's judgment layer reads past it when extracting candidate features. The summary prints the extracted text length; a value below ~200 chars prints a **thin-extraction warning** (usually a page that didn't render, or one that needs a higher `--wait` or a cloud/stealth browser — §6).

## §4 — References → discovery queue

Every **cross-site** link in the captured content (a different host than the page) is deduped, classified by destination (`github.com`→`repo`, `youtube`→`video`, `arxiv`→`paper`, `reddit`→`reddit`, `x.com`→`x`, else `article`), given a brand-label slug, and written to `discovery-queue.md`. Same-host links are internal navigation, not follow-on targets, so they're dropped.

## §5 — Recall

A single page is a closed set: its rendered DOM converted whole. The summary line is the recall signal — it reports the extracted text length and external-reference count, so a later reader can see whether the page rendered fully (healthy char count) or thinly (failed render). The places recall is best-effort: links that appear only _inside_ the page (image maps, canvas, JS-built menus the prune drops) are not followed, and a bot-walled page that serves a challenge instead of content needs the cloud/stealth path (§6).

## §6 — Fail soft

- **Browser not connected** (`active browser connections — 0` / `Connection refused`) — start the Chrome on the CDP port (§0) and retry; the capture stops rather than writing an empty source.
- **Thin extraction** (warning in the summary) — the page rendered wrong or incompletely. Record a self-healing recipe for the host (§7), then re-run with `--force`.
- **Bot wall / stealth needed (cloud extension)** — with `BROWSER_USE_API_KEY` set, browser-harness can drive a Browser Use cloud stealth browser (residential proxies, CAPTCHA solving) for pages that block the local Chromium, and run headless/unattended off your machine. Wiring a `--remote` path onto this script is the documented next step; v1 renders locally.
- **`research.mjs` write fails** — logged; fix the reported frontmatter issue and re-run with `--force`.

## §7 — Self-healing recipes

The deterministic prune handles most pages, but some sites need a quirk handled: a non-standard content root, a cookie/consent wall to dismiss, late SPA render to wait for, lazy-loaded content to scroll into view, or junk to strip. Rather than hand-tuning the script per site, those fixes live as **per-host recipes** in `scripts/site-recipes.json`, which the script auto-applies on every future capture of that host. This is browser-harness's self-healing idea (learn a site's quirks once, persist them, apply them next time) adapted to a deterministic pipeline — captures stay reproducible _and_ get better over time.

When a capture is thin or wrong, the healing loop is:

1. **Diagnose** — drive browser-harness interactively against the URL to find the fix: `capture_screenshot()` to see what rendered, `js("document.querySelector('…')")` to find the real content root, or check whether a cookie wall / late render is the blocker.
2. **Record** — add an entry to `scripts/site-recipes.json` under the exact host (`docs.example.com`) or the host brand (`example`); exact wins. All fields optional:

   ```json
   {
     "recipes": {
       "example.com": {
         "note": "main lives in .post-body; cookie wall; lazy images",
         "contentSelector": ".post-body",
         "removeSelectors": [".newsletter", ".related-posts"],
         "clickSelectors": ["#accept-cookies"],
         "waitForSelector": ".post-body img",
         "scrollToBottom": true,
         "wait": 3
       }
     }
   }
   ```

3. **Re-run** — `webpage-capture.mjs --url … --force`. The summary prints `[recipe applied]` and a healthy char count confirms the fix. Every later capture of that host inherits it.

Keep recipes durable, not brittle: prefer stable selectors and the `note` field over pixel coordinates or one-off hacks. A recipe is the site's map, not one run's diary.
