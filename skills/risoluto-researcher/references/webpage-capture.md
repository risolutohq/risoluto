# Web page capture (researcher Step 2b)

Read this only when `/risoluto-researcher` is capturing a generic web page — `source-type` is `article`. Captures **one page per URL** as clean structured markdown.

Renders the page in a real Chromium via [`browser-harness`](https://github.com/browser-use/browser-harness) (CDP), then converts the rendered DOM to markdown with a vendored [Turndown](https://github.com/mixmark-io/turndown) plus the [GFM table plugin](https://github.com/mixmark-io/turndown-plugin-gfm), and finishes with a deterministic `normalizeMarkdown()` cleanup pass. The whole pipeline is **deterministic** (no per-page LLM cost) — the LLM judgment happens later, at the candidate-feature layer, same as every other medium.

Why a real browser instead of fetch + readability: the medium is "any web page", including the JavaScript-rendered competitor SPAs we track as `peer`. A real Chrome materialises that content before extraction. browser-harness has no markdown extractor of its own, so the converter (`scripts/vendor/turndown.js` + `scripts/vendor/turndown-plugin-gfm.js`) is injected into the page. For the harder cases — collapsed widgets, infinite scroll, JSON-API-backed SPAs, bot walls, bulk sweeps — see the **§8 power-extraction playbook**.

Disciplines through the step:

- **Preflight before you render.** One cheap HTTP GET (Node `fetch`, redirects followed) runs first to learn what the renderer can't tell you up front: the canonical URL (a 301 alias is resolved, so you capture the real page under its real identity), whether the page is _static_ (its prose already in the raw HTML → JS render is overkill, so the settle wait is cut), and whether it is GitHub-Pages / repo-backed (provenance — the authoritative source may be a repo worth a `repo` capture). Best-effort: a network error degrades to "render the requested URL" (§1b).
- **Render, then convert, then normalise.** browser-harness loads the page in Chromium; a heuristic content-prune → Turndown (+ GFM tables) → `normalizeMarkdown()` produce the markdown (§2). research.mjs writes the title as the H1, so the page's own leading title block is stripped to avoid a duplicate (§2).
- **Every cross-site link is a discovery candidate.** External links (different host than the page) become follow-on targets; internal navigation is ignored (§4). A repo-backed page also seeds its source repo as a `repo` candidate (§1b).
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
| `--remote`        | off | render in a Browser Use cloud stealth browser instead of local Chromium (§6) |
| `--proxy-country` | —   | residential proxy country code for `--remote` (e.g. `de`, `us`)              |

**What it produces** under `research/targets/<host-brand>/`:

```
sources/<source-slug>.md   # provenance line, the converted markdown, references, why-it-matters
discovery-queue.md         # cross-site links worth their own capture
```

Written via `research.mjs` (`--source-type article`), so the frontmatter passes `validate:research`. The target is the **host brand** (a tweet groups under its author, a video under its channel, a page under its site).

## §1b — Preflight, static-detection, and repo provenance (automatic)

Before any browser work, `preflight(url)` does one `fetch` (redirects followed) and the rest of the run uses what it learns — no flag, always on, best-effort:

- **Canonical URL.** `res.url` after redirects becomes the URL rendered, the source identity, and the `url:` frontmatter. A site that 301s (or whose pretty domain is itself an alias) is captured as the real page, not the alias.
- **Static-detection.** `approxTextLen()` strips tags from the raw HTML and measures the visible text. At/above `STATIC_TEXT_MIN` (1500 chars) the prose is already present without JS, so the settle wait drops to `0.4s` (an explicit `--wait` or a recipe `wait` still wins). The render still runs — to skip Chromium entirely for static/bulk pages, use the no-browser path in **§8.5**.
- **Repo provenance.** `githubPagesInfo()` flags GitHub-Pages hosting (`server: GitHub.com`, or a `*.github.io` host) and, for a `<owner>.github.io/<repo>` URL, derives `owner/repo` deterministically. A known repo is written into the body's `> Hosting:` line **and** seeded into the discovery queue as a `repo` candidate (capture the canonical source with `--source-type repo`). A custom-domain Pages site is flagged as repo-backed but its repo isn't derivable from headers — the body says so.

The advisory prints to stderr each run, e.g. `preflight — static (223071 chars raw text — JS render not needed), GitHub Pages (custom domain)`.

## §2 — How the markdown is made

The in-page extractor (1) picks the content root (`main`, `article`, `[role=main]`, else `body`), (2) removes non-content nodes (`script`/`style`/`svg`/`iframe`/`nav`/`header`/`footer`/`aside`/`form`/`button` + `[aria-hidden]`/banner/navigation/contentinfo roles), (3) absolutises `href`/`src` so links and images keep real URLs, then (4) runs `TurndownService` (atx headings, fenced code, `-` bullets) **with the GFM table plugin** (`td.use(turndownPluginGfm.gfm)`), so a real `<table>` with a heading row becomes a markdown pipe table instead of flattening to text. The result is clean markdown — headings, lists, links, images, code blocks, **tables**, blockquotes all preserved.

The raw Turndown output then passes through `normalizeMarkdown()` (a pure, fence- and table-aware pass) before it is written, because a heavily-designed page flattens its visual chrome — hero counters, step-cards, the cells of a CSS-grid layout — into one-token-per-line soup and Turndown backslash-escapes punctuation that needed no escaping. The pass: unescapes `\_ \* \[`, merges a heading with its immediately-following italic subtitle, drops standalone decorative lines (lone emoji, `01 Eyebrow` labels, bare stat/year tokens left by a pruned counter), collapses runs of short orphan lines into one ` · `-joined row (bridging the single blank lines a card grid leaves between cells — a real sentence is never swept in), drops empty pure-pipe table-artifact rows, and collapses 3+ blank lines to one. Code fences and pipe-table rows pass through verbatim, so it composes safely with the GFM rule.

research.mjs writes the page title as the source H1, so `stripLeadingTitle` drops the page's own leading title block (any breadcrumb/logo cruft plus the first H1 if it sits in the lead) to avoid a duplicate heading. A late H1 deeper in the page is a real section heading and is kept.

> **Note on complex tables.** The GFM rule converts a `<table>` only when it has a heading row; a table without one is kept as raw HTML. An _expandable_ table (a `<tr>` of cells followed by a `<td colspan>` detail row, like a "click to expand" comparison grid) converts its main rows cleanly and leaves the detail prose between the rows — content-complete, but not a single contiguous markdown table. That is inherent to the source (markdown table cells can't hold multi-block content), not a converter bug.

## §3 — Content-selection limits (no Readability)

The prune is heuristic, not a full readability pass, so two kinds of cruft can survive: a newsletter/subscribe blurb or related-links strip that lives _inside_ the content container rather than in a `<footer>`. This is acceptable — the agent's judgment layer reads past it when extracting candidate features. The summary prints the extracted text length; a value below ~200 chars prints a **thin-extraction warning** (usually a page that didn't render, or one that needs a higher `--wait` or a cloud/stealth browser — §6).

## §4 — References → discovery queue

Every **cross-site** link in the captured content (a different host than the page) is deduped, classified by destination (`github.com`→`repo`, `youtube`→`video`, `arxiv`→`paper`, `reddit`→`reddit`, `x.com`→`x`, else `article`), given a brand-label slug, and written to `discovery-queue.md`. Same-host links are internal navigation, not follow-on targets, so they're dropped.

## §5 — Recall

A single page is a closed set: its rendered DOM converted whole. The summary line is the recall signal — it reports the extracted text length and external-reference count, so a later reader can see whether the page rendered fully (healthy char count) or thinly (failed render). The places recall is best-effort: links that appear only _inside_ the page (image maps, canvas, JS-built menus the prune drops) are not followed, and a bot-walled page that serves a challenge instead of content needs the cloud/stealth path (§6).

## §6 — Fail soft

- **Browser not connected** (`active browser connections — 0` / `Connection refused`) — start the Chrome on the CDP port (§0) and retry; the capture stops rather than writing an empty source.
- **Thin extraction** (warning in the summary) — the page rendered wrong or incompletely. Record a self-healing recipe for the host (§7), then re-run with `--force`.
- **Bot wall / stealth / unattended — use `--remote`.** Pass `--remote` (needs `BROWSER_USE_API_KEY`) to render in a Browser Use cloud stealth browser instead of the local Chromium — residential proxies (`--proxy-country <cc>`), CAPTCHA solving, and no dependency on a local Chrome, so it runs unattended/off-machine and past sites that block Chromium. The script provisions the cloud browser with a bounded timeout and stops it (ending billing) on both success and failure.
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

## §8 — Power-extraction playbook (the harness can do more than render-and-scrape)

The default path renders once and converts the DOM. That is the right tool for ~90% of pages, but browser-harness is a full CDP driver, so the hard 10% — content hidden behind a click, a scroll, an XHR, an iframe, or a bot wall, plus whole-site sweeps — has a better move than "render harder and hope". The wrapper **wires** the first three (recipe fields, no code needed); the rest are **agent-driven** patterns you reach for by driving browser-harness directly (pipe a Python script to its stdin) when a capture comes back thin or a target needs breadth. The exact driver API is in `browser-harness`'s own `SKILL.md`; the calls below are the load-bearing ones.

### §8.1 — Expand collapsed content before extracting (wired)

A "click to expand" comparison grid, an FAQ accordion, or a `<details>` block hides its real content until opened — the extractor would capture only the closed summaries. Two recipe knobs open it first:

- `expandAll: true` — force every `<details>` element `open` (safe; no clicks, no navigation).
- `expandSelectors: [".show-more", "[aria-expanded=false]"]` — click **all** matches of each selector (vs `clickSelectors`, which clicks only the **first** match of each — right for a single cookie wall, wrong for "expand all").

```json
"example.com": { "note": "spec table is a click-to-expand grid", "expandAll": true, "expandSelectors": [".row-toggle"] }
```

(Heads-up: a grid whose rows are _already in the DOM_ and only visually collapsed by CSS needs nothing here — the extractor reads the hidden nodes fine. Reach for expand-all only when the content is genuinely absent until opened.)

### §8.2 — Settle on the right signal, not a fixed sleep (wired)

A slow SPA isn't done when `load` fires. Instead of guessing a bigger `--wait`, wait on a concrete signal: `waitForSelector` (recipe) maps to `wait_for_element(sel, timeout=10)`. For network-driven pages, drive `wait_for_network_idle(timeout, idle_ms=500)` ad-hoc — it returns when no `Network.*` request has been in flight for `idle_ms`, which is what "the page finished loading its data" actually means.

### §8.3 — Lazy / infinite scroll (wired + ad-hoc)

`scrollToBottom: true` (recipe) does one scroll-to-bottom for lazy images. For an _infinite_ feed, loop ad-hoc until the page stops growing:

```python
last = 0
for _ in range(20):
    js("window.scrollTo(0, document.body.scrollHeight)")
    wait_for_network_idle(idle_ms=600)
    h = js("return document.body.scrollHeight")
    if h == last: break
    last = h
```

### §8.4 — Grab the JSON behind the page (network interception, ad-hoc)

The strongest trick, and the one this very guide preaches ("Step 2 — XHR Endpoint"): an SPA usually renders from a JSON API, and that JSON is cleaner, more complete, and more stable than anything scraped from the DOM. browser-harness enables the CDP `Network` domain on every session and buffers events — read them and pull the bodies:

```python
new_tab(URL); wait_for_network_idle()
for e in drain_events():
    if e["method"] == "Network.responseReceived":
        r = e["params"]["response"]
        if "application/json" in r.get("mimeType", "") and "/api/" in r["url"]:
            body = cdp("Network.getResponseBody", requestId=e["params"]["requestId"])
            data = json.loads(body["body"])          # the structured source, no scraping
```

For request **interception/replay** (auth headers, paging cursors), `cdp("Fetch.enable", patterns=[{"urlPattern":"*","requestStage":"Response"}])` then drain `Fetch.requestPaused`. When you capture an endpoint this way, store the JSON in the source body and add the endpoint URL to the discovery queue.

### §8.5 — Skip the browser entirely for static & bulk (ad-hoc, no Chromium)

Preflight (§1b) already tells you a page is static. When it is — or when you need many pages — Chromium is pure overhead. browser-harness ships a no-browser fetch that routes through Browser Use's residential proxy when `BROWSER_USE_API_KEY` is set (so it clears soft bot walls a plain `curl` can't), falling back to `urllib`:

```python
from concurrent.futures import ThreadPoolExecutor
urls = [l.strip() for l in open("urls.txt")]
with ThreadPoolExecutor(max_workers=16) as ex:
    pages = list(ex.map(http_get, urls))           # 249 static pages in ~3s, no browser
```

Convert the fetched HTML with **pandoc** (`pandoc -f html -t gfm-raw_html --wrap=none`), which handles tables natively, then run it through `normalizeMarkdown()`. Trade-off, and why this is _not_ the default: a DOM-less prune is coarser than the browser path's `main`/`article` content-root selection + recipe system, so it leaks more chrome (chat widgets, banners). Prefer the browser path for a single high-value page; prefer this for breadth or unattended runs. (`fetch_use.fetch_sync(url, proxy_country="de")` is the richer primitive — status, `.json()`, per-country proxy — when you need more than text.)

### §8.6 — Whole-site / sitemap sweep (ad-hoc)

To capture more than one page, enumerate first instead of crawling blind: `http_get("<host>/sitemap.xml")`, pull every `<loc>`, and capture each through the normal path (or §8.5 for static sites). A two-line sitemap fetch is how you confirm a "site" is really one page (a self-contained guide) or a hundred (a docs tree) before committing.

### §8.7 — Content in an iframe or shadow DOM (ad-hoc)

DOM reads with `js(...)` only see the top document. For embedded content, `iframe_target("embed.host")` returns the iframe's `targetId`; pass it as `js(expr, target_id=...)` to read inside it. For clicking through shadow DOM / cross-origin frames, `click_at_xy(x, y)` hit-tests in Chrome's browser process, so it goes through boundaries a selector can't reach (screenshot → read the pixel → click).

### §8.8 — Diagnose with your eyes, then record a recipe (ad-hoc → wired)

When a capture is thin or wrong and you don't know why, stop guessing: `capture_screenshot("/tmp/x.png", full=True)` to see what actually rendered, then `js("document.querySelector('main') && document.querySelector('main').innerText.length")` to find the real content root or confirm a cookie/consent wall. Whatever you learn becomes a durable §7 site-recipe (`contentSelector`, `clickSelectors`, `expandAll`, `waitForSelector`, …) so the next capture of that host is automatic. Bot wall that even a real Chromium can't pass → `--remote` (cloud stealth + residential proxy, §6).
