#!/usr/bin/env node
/**
 * risoluto-researcher: capture a generic web page as clean structured markdown into
 * research/targets/<host>/.
 *
 * Renders the page in the user's real Chromium via `browser-harness` (CDP), so JavaScript /
 * SPA content is fully materialised before extraction — then converts the rendered DOM to
 * markdown with a vendored Turndown (no per-page LLM cost, deterministic), extracts the
 * cross-site links into a discovery queue, and writes one schema-valid source file by
 * delegating to research.mjs (the already-validated writer).
 *
 * Why a real browser (not fetch + readability): the medium is "any web page", including the
 * JS-rendered competitor SPAs we track as `peer`. A real Chrome renders them faithfully; the
 * heuristic content-prune + Turndown then produces markdown. browser-harness has no markdown
 * extractor of its own, so the converter is vendored and injected into the page.
 *
 * Usage:
 *   node skills/risoluto-researcher/scripts/webpage-capture.mjs --url "https://..." \
 *     [--target-slug <host>] [--source-slug <slug>] [--category reference] \
 *     [--wait 1.5] [--force] [--dry-run] [--from-json <bh-result.json>]
 *
 * --from-json reads a saved BH_RESULT payload instead of driving the browser — used to resume
 * and to test the post-processing (slugs / discovery / delegation) without a live Chrome.
 *
 * Cloud/headless capture (Browser Use stealth browser, for bot-walled or unattended runs) is a
 * documented extension — see references/webpage-capture.md §6. v1 renders in the local browser.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { slugify, classifyDiscovery, suggestSlug, hostLabel, isMainEntry } from "./capture-lib.mjs";

export { slugify, classifyDiscovery, suggestSlug, hostLabel };

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const RESEARCH_DIR = path.join(REPO_ROOT, "research");
const TARGETS_DIR = path.join(RESEARCH_DIR, "targets");
const RESEARCH_SCRIPT = path.join(SCRIPT_DIR, "research.mjs");
const TURNDOWN_PATH = path.join(SCRIPT_DIR, "vendor", "turndown.js");
const RECIPES_PATH = path.join(SCRIPT_DIR, "site-recipes.json");

const MAX_MARKDOWN = 300_000; // hard cap so a pathological page can't bloat the corpus
const THIN_TEXT = 200; // below this many chars of extracted text, warn (likely a failed render)

const BASE_JUNK =
  "script,style,noscript,svg,iframe,nav,header,footer,aside,form,button,template," +
  "[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true]";
const DEFAULT_CONTENT_SEL = "main, article, [role=main]";

/**
 * Build the in-page extractor: pick the content root (recipe override or the default), prune
 * non-content nodes (base set + any recipe-supplied selectors), absolutise links/images so
 * markdown keeps real URLs, convert the cleaned DOM with the injected TurndownService, and
 * report metadata. Starts with "(" so browser-harness runs it at global scope without its
 * auto-IIFE wrap.
 * @param {string} contentSelector
 * @param {string[]} removeSelectors  extra selectors to prune
 * @param {string[]} keepSelectors    base-prune selectors to spare (e.g. ["button"] for accordion sites)
 * @returns {string} a JS expression
 */
export function buildExtractorJS(contentSelector, removeSelectors, keepSelectors) {
  const keep = new Set((keepSelectors || []).map((s) => s.trim()));
  const base = BASE_JUNK.split(",").filter((s) => !keep.has(s.trim()));
  const junk = [...base, ...(removeSelectors || [])].join(",");
  return `(function () {
  var JUNK = ${JSON.stringify(junk)};
  var main = document.querySelector(${JSON.stringify(contentSelector || DEFAULT_CONTENT_SEL)}) || document.body;
  var clone = main.cloneNode(true);
  Array.prototype.forEach.call(clone.querySelectorAll(JUNK), function (n) { n.remove(); });
  Array.prototype.forEach.call(clone.querySelectorAll("a[href]"), function (a) { a.setAttribute("href", a.href); });
  Array.prototype.forEach.call(clone.querySelectorAll("img[src]"), function (i) { i.setAttribute("src", i.src); });
  var td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", hr: "---", emDelimiter: "_" });
  var markdown = td.turndown(clone.innerHTML).trim();
  var links = Array.prototype.slice.call(clone.querySelectorAll("a[href]"))
    .map(function (a) { return a.href; })
    .filter(function (h) { return /^https?:/.test(h); });
  var meta = function (sel) { var e = document.querySelector(sel); return (e && e.content) || ""; };
  return {
    ok: true,
    byline: meta("meta[name=author]") || meta('meta[property="article:author"]'),
    excerpt: meta("meta[name=description]") || meta('meta[property="og:description"]'),
    markdown: markdown,
    links: Array.from(new Set(links)),
    textLen: (clone.innerText || "").length,
  };
})()`;
}

// ---------------------------------------------------------------------------
// Pure transforms (exported for fixture testing — no I/O, no network)
// ---------------------------------------------------------------------------

/** Find the `BH_RESULT:` line in the harness stdout and parse its JSON payload. */
export function parseBHResult(stdout) {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .find((l) => l.startsWith("BH_RESULT:"));
  if (!line) throw new Error("browser-harness produced no BH_RESULT payload (render or injection failed)");
  return JSON.parse(line.slice("BH_RESULT:".length));
}

/**
 * Pick the self-healing recipe for a URL from the loaded store: an exact-host entry wins over a
 * host-brand entry. The recipe carries learned overrides (content selector, extra prune
 * selectors, pre-extraction clicks, wait-for-selector, scroll, settle). {} when none matches.
 * @param {object} store  parsed site-recipes.json ({ recipes: { <host>: {...} } })
 * @param {string} url
 * @returns {object}
 */
export function selectRecipe(store, url) {
  const recipes = (store && store.recipes) || {};
  const host = (/https?:\/\/(?:www\.)?([^/]+)/.exec(url || "") || [])[1] || "";
  return recipes[host] || recipes[hostLabel(url)] || {};
}

/** Target slug for a page = the host's brand label (news.ycombinator.com → ycombinator). */
export function hostSlug(url) {
  return hostLabel(url) || "web";
}

/** Source slug from the last meaningful path segment, else a slug of the title. */
export function deriveSourceSlug(url, title) {
  const segs = (/https?:\/\/[^/]+\/([^?#]*)/.exec(url || "") || [])[1]?.split("/").filter(Boolean) || [];
  const last = segs.length ? segs[segs.length - 1].replace(/\.(html?|php|aspx)$/i, "") : "";
  const fromPath = slugify(last);
  if (fromPath && fromPath.length >= 2) return fromPath.slice(0, 60);
  return slugify(title).slice(0, 60) || "page";
}

/** One-line title for the source H1 (research.mjs prepends it as the H1). */
export function deriveTitle(pageTitle, url) {
  const t = String(pageTitle || "")
    .replace(/^\u{1F434}\s*/u, "") // strip browser-harness's tab-ownership marker (🐴)
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return `Web page ${hostSlug(url)}`;
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
}

/**
 * Drop the page's leading title block — any nav/logo cruft plus the first H1 if it sits near
 * the top — because research.mjs already writes the source title as the H1. A late H1 (deeper
 * than the lead) is a real section heading, so it's left intact.
 */
export function stripLeadingTitle(markdown) {
  const md = String(markdown || "");
  const m = /^#\s+.+$/m.exec(md);
  if (m && m.index <= 600) return md.slice(m.index + m[0].length).replace(/^\s+/, "");
  return md;
}

/** Cross-site links (different host than the page) — internal nav is not a discovery target. */
export function externalLinks(links, pageUrl) {
  const pageHost = (/https?:\/\/(?:www\.)?([^/]+)/.exec(pageUrl || "") || [])[1] || "";
  const out = [];
  const seen = new Set();
  for (const u of links || []) {
    const host = (/https?:\/\/(?:www\.)?([^/]+)/.exec(u) || [])[1] || "";
    const key = u.toLowerCase();
    if (!host || host === pageHost || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** Compose the source body: provenance line, the converted markdown, references, why-it-matters. */
export function composeBody(meta, markdown, refs) {
  const lines = [`> Web capture from ${meta.host}${meta.byline ? ` · by ${meta.byline}` : ""}`, ""];
  lines.push(stripLeadingTitle(markdown).trim() || "_(no extractable content)_");

  if (refs.length) {
    lines.push("", "## References", "");
    refs.forEach((u) => lines.push(`- ${u}  _(→ discovery: ${classifyDiscovery(u)})_`));
  }

  lines.push(
    "",
    "## Why this matters for Risoluto",
    "",
    "TODO — agent fills: which AFK job / capability does this page surface? Promote any",
    "follow-on references from the discovery queue to their own `/risoluto-researcher` runs.",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// I/O orchestration (not exported)
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`webpage-capture: ${msg}`);
  process.exit(1);
}

function parseArgs(raw) {
  const args = {
    url: "",
    targetSlug: "",
    sourceSlug: "",
    category: "reference",
    wait: null,
    force: false,
    dryRun: false,
    fromJson: "",
    remote: false,
    proxyCountry: "",
  };
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case "--url":
        args.url = raw[++i] ?? "";
        break;
      case "--target-slug":
        args.targetSlug = raw[++i] ?? "";
        break;
      case "--source-slug":
        args.sourceSlug = raw[++i] ?? "";
        break;
      case "--category":
        args.category = raw[++i] ?? "reference";
        break;
      case "--wait":
        args.wait = Number(raw[++i]);
        break;
      case "--force":
        args.force = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--from-json":
        args.fromJson = raw[++i] ?? "";
        break;
      case "--remote":
        args.remote = true;
        break;
      case "--proxy-country":
        args.proxyCountry = raw[++i] ?? "";
        break;
      default:
        fail(`unknown flag: ${raw[i]}`);
    }
  }
  return args;
}

function checkPreconditions(args) {
  if (!existsSync(path.join(REPO_ROOT, "package.json")) || !existsSync(path.join(REPO_ROOT, ".gitmodules"))) {
    fail(`run from the repo root — expected package.json + .gitmodules at ${REPO_ROOT}`);
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".git"))) {
    fail("research/ submodule is not initialised — run `git submodule update --init research`");
  }
  if (!existsSync(path.join(RESEARCH_DIR, ".schemas"))) {
    fail("research/.schemas/ missing — frontmatter schemas are not present");
  }
  if (!["peer", "reference", "adjacent"].includes(args.category)) {
    fail(`--category must be peer|reference|adjacent, got: ${args.category}`);
  }
  if (!args.url && !args.fromJson) fail("usage: webpage-capture.mjs --url <url>");
  if (!args.fromJson) {
    if (!existsSync(TURNDOWN_PATH)) fail(`vendored Turndown missing at ${TURNDOWN_PATH}`);
    try {
      execFileSync("browser-harness", ["--version"], { stdio: "ignore" });
    } catch {
      fail("browser-harness not found — install it and enable Chrome remote debugging (see install.md)");
    }
    if (args.remote && !process.env.BROWSER_USE_API_KEY) {
      fail("--remote needs BROWSER_USE_API_KEY (Browser Use cloud) — export it or add it to browser-harness's .env");
    }
  }
}

/** Load + select the self-healing recipe for a URL ({} if no store or no match). */
function loadRecipe(url) {
  if (!existsSync(RECIPES_PATH)) return {};
  try {
    return selectRecipe(JSON.parse(readFileSync(RECIPES_PATH, "utf8")), url);
  } catch (error) {
    console.error(`webpage-capture: ignoring unreadable site-recipes.json — ${error.message}`);
    return {};
  }
}

/**
 * Build the Python render driver browser-harness runs on stdin. Applies the recipe's learned
 * steps — pre-extraction clicks (cookie/consent walls), wait-for-selector (late SPA render),
 * scroll (lazy-load), settle — then injects Turndown and runs the recipe-tuned extractor. Cloud
 * provisioning is handled separately in loadPage (a distinct invocation), so this driver is
 * identical for local and cloud runs. JSON-encoding every interpolated value keeps the generated
 * Python safe.
 */
function buildDriver(url, recipe, wait) {
  const opts = {
    wait: Number.isFinite(wait) ? wait : 1.5,
    waitForSelector: recipe.waitForSelector || "",
    clickSelectors: recipe.clickSelectors || [],
    scrollToBottom: !!recipe.scrollToBottom,
  };
  const extractor = buildExtractorJS(recipe.contentSelector, recipe.removeSelectors, recipe.keepSelectors);
  return `import json, time
URL = ${JSON.stringify(url)}
OPTS = json.loads(${JSON.stringify(JSON.stringify(opts))})
TD = open(${JSON.stringify(TURNDOWN_PATH)}).read()
EXT = ${JSON.stringify(extractor)}
new_tab(URL)
wait_for_load(20)
for sel in OPTS["clickSelectors"]:
    try:
        js("(function(){var e=document.querySelector(" + json.dumps(sel) + ");if(e){e.click();return true}return false})()")
        time.sleep(0.5)
    except Exception:
        pass
if OPTS["waitForSelector"]:
    try:
        wait_for_element(OPTS["waitForSelector"], timeout=10)
    except Exception:
        pass
if OPTS["scrollToBottom"]:
    try:
        js("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(1)
    except Exception:
        pass
time.sleep(OPTS["wait"])
js(TD)
out = js(EXT)
info = page_info()
try:
    close_tab()
except Exception:
    pass
print("BH_RESULT:" + json.dumps({"finalUrl": info.get("url", ""), "pageTitle": info.get("title", ""), "data": out}))
`;
}

const REMOTE_NAME = "webcap";

/** Run browser-harness with a Python driver on stdin; returns stdout (throws on failure). */
function runHarness(input, env, timeout) {
  return execFileSync("browser-harness", [], { input, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, env, timeout });
}

/**
 * Render the page and return the parsed BH_RESULT. Local: one invocation against the default
 * daemon. Cloud (`--remote`): the documented three-step dance — (1) under the default daemon,
 * clear any stale `webcap` daemon and `start_remote_daemon` (bounded timeout so billing can't run
 * away; optional residential proxy); (2) render under `BU_NAME=webcap` (the cloud browser); (3)
 * `stop_remote_daemon` so the cloud browser stops and billing ends, in both success and failure
 * paths. Provisioning is a separate invocation because setting `BU_NAME=webcap` up front makes
 * ensure_daemon auto-start a *local* webcap daemon that collides with start_remote_daemon.
 */
function loadPage(args, recipe, wait) {
  if (args.fromJson) return parseBHResult(`BH_RESULT:${readFileSync(args.fromJson, "utf8")}`);
  const renderDriver = buildDriver(args.url, recipe, wait);
  if (!args.remote) {
    try {
      return parseBHResult(runHarness(renderDriver, process.env, 90_000));
    } catch (error) {
      fail(`browser-harness failed — ${error.stderr || error.message}`);
    }
  }
  const n = JSON.stringify(REMOTE_NAME);
  const proxy = args.proxyCountry ? `, proxyCountryCode=${JSON.stringify(args.proxyCountry)}` : "";
  const provision =
    `from browser_harness.admin import restart_daemon, start_remote_daemon\n` +
    `restart_daemon(${n})\nstart_remote_daemon(${n}, timeout=180${proxy})`;
  const stop = `from browser_harness.admin import stop_remote_daemon\nstop_remote_daemon(${n})`;
  let stdout;
  try {
    runHarness(provision, process.env, 150_000);
    stdout = runHarness(renderDriver, { ...process.env, BU_NAME: REMOTE_NAME }, 200_000);
  } catch (error) {
    try {
      runHarness(stop, process.env, 60_000);
    } catch {
      /* best-effort — the daemon also self-stops at its timeout */
    }
    fail(`browser-harness (cloud) failed — ${error.stderr || error.message}`);
  }
  try {
    runHarness(stop, process.env, 60_000);
  } catch {
    /* best-effort cleanup */
  }
  return parseBHResult(stdout);
}

function writeSource(payload, slugs, args) {
  const data = payload.data || {};
  const url = payload.finalUrl || args.url;
  const host = (/https?:\/\/(?:www\.)?([^/]+)/.exec(url) || [])[1] || slugs.target;
  const refs = externalLinks(data.links, url);
  const markdown = String(data.markdown || "").slice(0, MAX_MARKDOWN);
  const body = composeBody({ host, byline: data.byline }, markdown, refs);

  const bodyFile = path.join(tmpdir(), `webpage-${slugs.source}.md`);
  writeFileSync(bodyFile, body);
  const cliArgs = [
    RESEARCH_SCRIPT,
    "--url",
    url,
    "--target-slug",
    slugs.target,
    "--category",
    args.category,
    "--source-type",
    "article",
    "--source-slug",
    slugs.source,
    "--title",
    deriveTitle(payload.pageTitle, url),
    "--description",
    `Web sources from ${host} — pages captured as research source material.`,
    "--body-file",
    bodyFile,
  ];
  if (args.dryRun) cliArgs.push("--dry-run");
  try {
    execFileSync("node", cliArgs, { cwd: REPO_ROOT, stdio: "ignore" });
  } catch (error) {
    fail(`research.mjs failed for ${slugs.source} — ${error.message}`);
  }
  return { written: 1, refs, textLen: data.textLen || 0 };
}

function writeDiscoveryQueue(refs, targetSlug, dryRun) {
  const rows = refs.map((u) => `| ${u} | ${classifyDiscovery(u)} | \`${suggestSlug(u)}\` |`);
  const content = [
    `# Discovery queue — from ${targetSlug}`,
    "",
    "Follow-on capture candidates extracted from captured pages. Each row is a reference",
    "worth its own `/risoluto-researcher` run. Promote it, then delete the row.",
    "",
    "| Reference | Type | Suggested slug |",
    "| --------- | ---- | -------------- |",
    ...rows,
    "",
  ].join("\n");
  if (!dryRun) {
    const dest = path.join(TARGETS_DIR, targetSlug, "discovery-queue.md");
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return rows.length;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  checkPreconditions(args);

  const recipe = args.fromJson ? {} : loadRecipe(args.url);
  const wait = Number.isFinite(args.wait) ? args.wait : (recipe.wait ?? 1.5);
  const payload = loadPage(args, recipe, wait);
  if (!payload?.data?.ok) fail(`extraction failed for ${args.url} — page returned no content`);

  const url = payload.finalUrl || args.url;
  const slugs = {
    target: args.targetSlug || hostSlug(url),
    source: args.sourceSlug || deriveSourceSlug(url, payload.pageTitle),
  };

  const sourcePath = path.join(TARGETS_DIR, slugs.target, "sources", `${slugs.source}.md`);
  if (existsSync(sourcePath) && !args.force && !args.dryRun) {
    fail(`already captured: ${sourcePath} (use --force to overwrite)`);
  }

  const { refs, textLen } = writeSource(payload, slugs, args);
  const discoveryRows = writeDiscoveryQueue(refs, slugs.target, args.dryRun);

  const recipeNote = Object.keys(recipe).length ? " [recipe applied]" : "";
  const thin = textLen < THIN_TEXT ? " ⚠️ thin extraction — add a site recipe (webpage-capture.md §7)" : "";
  console.error(
    `webpage-capture: ${args.dryRun ? "[dry-run] " : ""}${args.remote ? "[cloud] " : ""}${url} → 1 source written ` +
      `(target ${slugs.target}/${slugs.source}), ${textLen} chars text, ${refs.length} external refs ` +
      `→ ${discoveryRows} discovery candidates${recipeNote}${thin}`,
  );
  if (!args.dryRun) console.error("webpage-capture: run `pnpm validate:research` to verify the corpus.");
}

if (isMainEntry(import.meta.url)) {
  main();
}
