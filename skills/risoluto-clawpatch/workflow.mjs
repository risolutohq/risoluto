export const meta = {
  name: "risoluto-clawpatch",
  description:
    "Native whole-repo slice-by-slice code review: map the repo into semantic feature slices, review each across all 10 categories, merge+dedup, adversarially verify (3 skeptics/finding), then emit a review-handoff.v1 markdown for a fresh fixing session.",
  whenToUse:
    "Whole-repo clawpatch-style review when you want a verified, handoff-ready findings list (not auto-fix). Pass args.changedFiles for a diff-scoped run.",
  phases: [
    { title: "Map", detail: "one mapper agent per spine layer -> semantic feature slices", model: "sonnet" },
    { title: "Review", detail: "one reviewer per slice, all 10 categories, strict evidence", model: "sonnet" },
    { title: "Verify", detail: "3 perspective-diverse skeptics per finding, refute-or-survive", model: "opus" },
    { title: "Handoff", detail: "synthesize review-handoff.v1 markdown", model: "opus" },
  ],
};

// ---------------------------------------------------------------------------
// Static repo knowledge: the 6+1 spine layers and the src/ modules they own.
// Mappers split these into semantic feature slices; reviewers never see a raw
// directory dump. Source: docs/technical-spine.md + repo structure recon.
// ---------------------------------------------------------------------------
const DEFAULT_LAYERS = [
  { key: "surfaces", name: "Operator Surfaces", modules: ["cli", "http"] },
  { key: "intake", name: "Intake & Mirror", modules: ["webhook", "linear", "github", "tracker", "automation"] },
  {
    key: "engine",
    name: "Core Workflow Engine",
    modules: ["workflow-run", "workflow-definition", "state", "dispatch", "core"],
  },
  { key: "runtime", name: "Role Execution Runtime", modules: ["agent", "agent-runner", "codex", "prompt", "config"] },
  { key: "persistence", name: "Persistence & Evidence", modules: ["persistence"] },
  {
    key: "observability",
    name: "Observability",
    modules: ["observability", "audit", "health", "alerts", "notification"],
  },
  {
    key: "infra",
    name: "Infrastructure",
    modules: ["git", "workspace", "docker", "secrets", "live", "setup", "utils", "orchestrator"],
  },
];

const CATEGORIES = [
  "bug",
  "security",
  "performance",
  "concurrency",
  "api-contract",
  "data-loss",
  "test-gap",
  "docs-gap",
  "build-release",
  "maintainability",
];

const SEVERITIES = ["critical", "high", "medium", "low"];
const KINDS = [
  "cli-command",
  "route",
  "service",
  "job",
  "agent-tool",
  "library",
  "config",
  "release",
  "test-suite",
  "infra",
  "unknown",
];
const TRUST_BOUNDARIES = [
  "user-input",
  "network",
  "filesystem",
  "secrets",
  "process-exec",
  "database",
  "auth",
  "permissions",
  "concurrency",
  "external-api",
  "serialization",
];

// Repo-specific false-positive guards. This repo's prior sweeps ran 34-50% FP;
// these are the patterns that produced most of them (memory: clawpatch-round1).
const FP_GUARDS = `Repo-specific FALSE-POSITIVE guards (this repo historically runs 34-50% FP - respect them):
- Express 5.2.1: async route-handler promise rejections ARE framework-handled. Do NOT flag "unhandled rejection in an async Express handler".
- "No tests just for coverage" is a hard repo rule. A test-gap is valid ONLY if it leaves a real, currently-unprotected behavior with a falsifiable failure mode - never coverage padding. If a test would only pad coverage, drop the finding and set suggestedRegressionTest to null.
- type-coverage >= 95% and ESLint complexity <= 15 are already gate-enforced. Do NOT raise findings about missing types or high cyclomatic complexity that the gate already governs.
- issueId / issue_id is a LEGITIMATE tracker coordinate, not a bug. Only flag it where a WorkflowRun id is semantically required and a tracker id is wrongly substituted.
- Known deferred-as-UNSAFE (do NOT re-raise as actionable; if seen, severity low + note "known-deferred"): (a) src/workflow-run/intake-core.ts "write-before-claim" reorder - the claim IS the dedup gate, reordering breaks concurrent-duplicate idempotency; (b) src/workflow-run/drive-done-handoff.ts making budget elapsedMs/costUsd nullable - breaks the persisted handoff.v1 on-disk contract.`;

const EVIDENCE_ITEM = {
  type: "object",
  required: ["path"],
  properties: {
    path: { type: "string" },
    startLine: { type: ["integer", "null"] },
    endLine: { type: ["integer", "null"] },
    symbol: { type: ["string", "null"] },
    quote: { type: ["string", "null"] },
  },
};

const SLICE_SCHEMA = {
  type: "object",
  required: ["slices"],
  properties: {
    slices: {
      type: "array",
      items: {
        type: "object",
        required: ["featureId", "title", "kind", "ownedFiles"],
        properties: {
          featureId: { type: "string" },
          title: { type: "string" },
          kind: { type: "string", enum: KINDS },
          entrypoints: { type: "array", items: { type: "string" } },
          ownedFiles: { type: "array", items: { type: "string" } },
          contextFiles: { type: "array", items: { type: "string" } },
          tests: { type: "array", items: { type: "string" } },
          trustBoundaries: { type: "array", items: { type: "string", enum: TRUST_BOUNDARIES } },
        },
      },
    },
  },
};

const REVIEW_SCHEMA = {
  type: "object",
  required: ["findings", "inspected"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "category", "severity", "confidence", "evidence", "reasoning", "recommendation"],
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: SEVERITIES },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: "array", items: EVIDENCE_ITEM },
          reasoning: { type: "string" },
          reproduction: { type: ["string", "null"] },
          recommendation: { type: "string" },
          suggestedRegressionTest: { type: ["string", "null"] },
          minimumFixScope: { type: ["string", "null"] },
        },
      },
    },
    inspected: {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["refuted", "reason"],
  properties: {
    refuted: { type: "boolean" },
    reason: { type: "string" },
    evidenceMatches: { type: ["boolean", "null"] },
    adjustedSeverity: { type: ["string", "null"], enum: [...SEVERITIES, null] },
  },
};

const V1_FINDING = {
  type: "object",
  required: ["id", "severity", "file", "line", "problem", "fix", "trace", "status"],
  properties: {
    id: { type: "string" },
    severity: { type: "string", enum: ["HIGH", "MED", "NIT"] },
    file: { type: "string" },
    line: { type: ["integer", "null"] },
    problem: { type: "string" },
    fix: { type: "string" },
    trace: { type: "string" },
    status: { type: "string", enum: ["open"] },
  },
};

const HANDOFF_SCHEMA = {
  type: "object",
  required: ["handoff", "markdown"],
  properties: {
    handoff: {
      type: "object",
      required: ["contract", "slug", "branch", "base", "reviewed_by", "summary", "findings"],
      properties: {
        contract: { type: "string" },
        slug: { type: "string" },
        branch: { type: "string" },
        base: { type: "string" },
        reviewed_by: { type: "string" },
        ac_summary: { type: "null" },
        summary: {
          type: "object",
          required: ["high", "med", "nit"],
          properties: { high: { type: "integer" }, med: { type: "integer" }, nit: { type: "integer" } },
        },
        findings: { type: "array", items: V1_FINDING },
      },
    },
    markdown: { type: "string" },
  },
};

// ----------------------------- plain helpers -------------------------------
function normPath(p) {
  return String(p || "")
    .replace(/^\.?\//, "")
    .trim();
}
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
function sevRank(s) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s] || 0;
}
function primaryEvidence(f) {
  return (f.evidence && f.evidence[0]) || {};
}
function signature(f) {
  const ev = primaryEvidence(f);
  return `${f.category}|${normPath(ev.path)}:${ev.startLine ?? "?"}|${slugify(f.title)}`;
}
function dedupeEvidence(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    const k = `${normPath(e.path)}:${e.startLine ?? "?"}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
function dedupeBySignature(findings) {
  const map = new Map();
  for (const f of findings) {
    const sig = signature(f);
    const cur = map.get(sig);
    if (!cur) {
      map.set(sig, { ...f, slices: [f.featureId].filter(Boolean) });
      continue;
    }
    if (f.featureId && !cur.slices.includes(f.featureId)) cur.slices.push(f.featureId);
    cur.evidence = dedupeEvidence([...(cur.evidence || []), ...(f.evidence || [])]);
    if (sevRank(f.severity) > sevRank(cur.severity)) cur.severity = f.severity;
    if (sevRank(f.confidence) > sevRank(cur.confidence)) cur.confidence = f.confidence;
  }
  return [...map.values()];
}
function compactFinding(f) {
  return {
    title: f.title,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    evidence: (f.evidence || []).slice(0, 3).map((e) => ({
      path: e.path,
      startLine: e.startLine ?? null,
      endLine: e.endLine ?? null,
      symbol: e.symbol ?? null,
      quote: e.quote ?? null,
    })),
    reasoning: f.reasoning,
    reproduction: f.reproduction ?? null,
    recommendation: f.recommendation,
    suggestedRegressionTest: f.suggestedRegressionTest ?? null,
    minimumFixScope: f.minimumFixScope ?? null,
    featureId: f.featureId ?? null,
    slices: f.slices ?? (f.featureId ? [f.featureId] : []),
  };
}

// ------------------------------- prompts -----------------------------------
function mapPrompt(layer, root) {
  return `You are a code-review FEATURE MAPPER for the Risoluto repo (root: ${root}, paths are repo-relative).
Map the "${layer.name}" spine layer into REVIEWABLE FEATURE SLICES - semantic units (a capability/entrypoint plus the files that implement it), NOT raw directory dumps.
This layer owns these directories under src/: ${layer.modules.map((m) => "src/" + m).join(", ")}.

Use colgrep / rg / ls / Read to inspect the code. For each feature slice output:
- featureId: stable kebab id, prefixed "${layer.key}-" (e.g. "${layer.key}-run-executor")
- title: short human title
- kind: one of ${KINDS.join(" | ")}
- entrypoints: the public entry files/symbols of the slice
- ownedFiles: the slice's own implementation files, repo-relative, CAP 12
- contextFiles: key imported contracts/types the slice depends on, repo-relative, CAP 8
- tests: related test files under tests/ if any
- trustBoundaries: subset of ${TRUST_BOUNDARIES.join(", ")}

Rules:
- SPLIT large modules (http, workflow-run, orchestrator each exceed 6k LOC) into MULTIPLE slices at functional seams so no slice exceeds ~12 owned files.
- COVER every non-test source file in this layer's modules across your slices - no orphaned files. A file may be context for several slices but owned by exactly one.
- Exclude generated/build output. Do not own test files (list them under tests).
Return strict JSON per the schema.`;
}

function reviewPrompt(slice, root) {
  return `You are a senior code reviewer reviewing ONE feature slice of the Risoluto repo (root: ${root}, paths repo-relative).
Slice: "${slice.title}" [kind=${slice.kind}${slice.layer ? ", layer=" + slice.layer : ""}]
Owned files: ${(slice.ownedFiles || []).join(", ") || "(none)"}
Context files (read-only deps): ${(slice.contextFiles || []).join(", ") || "(none)"}
Tests: ${(slice.tests || []).join(", ") || "(none)"}
Trust boundaries: ${(slice.trustBoundaries || []).join(", ") || "(none)"}

READ every owned file in full and skim the context files (use Read / colgrep). Hunt for REAL findings across ALL these categories: ${CATEGORIES.join(", ")}.

For each finding emit: title; category; severity (critical|high|medium|low); confidence (high|medium|low); evidence (each item: path, startLine, endLine, symbol, and an EXACT quote copied verbatim from the file at that line); reasoning (the concrete failure mode, not a vibe); reproduction (steps or null); recommendation; suggestedRegressionTest (null if it would be coverage-only); minimumFixScope.

EVIDENCE RULE: every finding MUST cite at least one owned/context file with a verbatim quote that matches the current file at the given line. No matching quote => no finding.
${FP_GUARDS}

Prefer precision over recall: a wrong finding is worse than a missed one, because a downstream session will act on it. If the slice is clean, return findings: []. Always return inspected.files (what you actually read) and inspected.notes (anything notable but not a finding).
Return strict JSON per the schema.`;
}

const REFUTE_LENSES = [
  {
    key: "evidence",
    instruction:
      "EVIDENCE CHECK: Re-open the cited file(s) at path:line with Read. Does the quoted text actually exist there in the CURRENT source and mean what the finding claims? If the quote is missing, paraphrased, stale, or at the wrong line, refute.",
  },
  {
    key: "reasoning",
    instruction:
      "REASONING CHECK: Is the causal claim actually true given how this code, its real callers, and the framework (Express 5, the persistence layer, the run state machine) behave? Trace at least one real caller. If the described failure mode cannot actually occur, refute.",
  },
  {
    key: "impact",
    instruction:
      "IMPACT/REACHABILITY CHECK: Is this reachable on a real production path (not only tests) and does it actually matter? Coverage-padding test-gaps, issues already enforced by the gate, known-deferred items, tracker-id-as-coordinate, and stylistic nits dressed as bugs => refute.",
  },
];

function refutePrompt(finding, lens, root) {
  const minimal = {
    title: finding.title,
    category: finding.category,
    severity: finding.severity,
    evidence: (finding.evidence || []).slice(0, 3),
    reasoning: finding.reasoning,
    recommendation: finding.recommendation,
  };
  return `You are an ADVERSARIAL SKEPTIC reviewing a single code-review finding for the Risoluto repo (root: ${root}, paths repo-relative).
Your DEFAULT POSITION is that this finding is a FALSE POSITIVE. Refute it unless the evidence is undeniable.

Finding under review:
${JSON.stringify(minimal, null, 2)}

Your lens for this pass:
${lens.instruction}
${FP_GUARDS}

Use Read / colgrep to check the real source. Then return:
- refuted: true if this is NOT a real, actionable, correctly-reasoned finding (when uncertain, refuted = true)
- reason: one concrete sentence
- evidenceMatches: does the cited quote match the current file? true / false / null
- adjustedSeverity: if the finding is real but mis-severitied, the corrected severity, else null
Return strict JSON per the schema.`;
}

function synthPrompt(confirmed, stats, ids) {
  return `You are assembling the final REVIEW HANDOFF a fresh session will use to fix the repo. ${confirmed.length} findings survived adversarial verification (raw: ${stats.raw}, after dedup: ${stats.deduped}, refuted: ${stats.dropped}).

Confirmed findings (JSON):
${JSON.stringify(confirmed, null, 2)}

Produce TWO things in strict JSON per the schema:

1) handoff = a review-handoff.v1 object:
   contract: "review-handoff.v1"
   slug: "${ids.slug}"
   branch: "${ids.branch}"
   base: "${ids.base}"
   reviewed_by: "${ids.reviewedBy}"
   ac_summary: null
   summary: { high, med, nit }  (integer counts matching findings below)
   findings[]: each { id, severity, file, line, problem, fix, trace, status }
     - id: "H1","H2",... then "M1",... then "N1",...
     - severity: map critical/high -> "HIGH", medium -> "MED", low -> "NIT"
     - file: the primary evidence path; line: primary evidence startLine or null
     - problem: one concrete sentence (what is wrong)
     - fix: the concrete change to make, actionable WITHOUT re-deriving
     - trace: "category=<category>; slice=<featureId>; layer=<layer-or-na>"
     - status: "open"
   Order findings HIGH first, then MED, then NIT.

2) markdown = the human-readable REVIEW body (do NOT include a \`\`\`json block - it is injected separately). Structure:
   "## Summary" - one paragraph: the counts, plus the top 2-4 root-cause CLUSTERS (group findings sharing a root cause), each with the finding ids in it.
   "## HIGH" / "## MED" / "## NIT" sections. Under each, one bullet per finding:
     "[<id>] <file>:<line> - <problem>"
       "  fix: <fix>"
       "  why: <reasoning>"
       "  repro: <reproduction or n/a>"
       "  test: <suggestedRegressionTest or n/a>"
       "  scope: <minimumFixScope or n/a>"
   Terse and scannable. Omit a severity section if it has no findings.

If confirmed is empty, still return a valid handoff with summary {high:0,med:0,nit:0}, findings:[], and a markdown that states the sweep found no surviving findings.
Return strict JSON per the schema.`;
}

// ------------------------------- the run -----------------------------------
const root = (args && args.root) || ".";
const date = (args && args.date) || "undated";
const ids = {
  slug: `clawpatch-sweep-${date}`,
  branch: (args && args.branch) || "(working tree)",
  base: (args && args.base) || "origin/master",
  reviewedBy: (args && args.reviewedBy) || "claude-opus-4-8 (risoluto-clawpatch)",
};
const layers = (args && args.layers) || DEFAULT_LAYERS;

// --- Phase 1: Map -----------------------------------------------------------
phase("Map");
const mapResults = await parallel(
  layers.map((layer) => () =>
    agent(mapPrompt(layer, root), {
      label: `map:${layer.key}`,
      phase: "Map",
      model: "sonnet",
      schema: SLICE_SCHEMA,
    }).then((r) => (r.slices || []).map((s) => ({ ...s, layer: layer.name }))),
  ),
);
let slices = mapResults.filter(Boolean).flat();
log(`map: ${slices.length} feature slices across ${layers.length} layers`);

// Optional diff-scope: skill passes changedFiles (git diff --name-only) for --since runs.
if (args && Array.isArray(args.changedFiles) && args.changedFiles.length) {
  const changed = new Set(args.changedFiles.map(normPath));
  const before = slices.length;
  slices = slices.filter((s) =>
    [...(s.ownedFiles || []), ...(s.contextFiles || [])].some((f) => changed.has(normPath(f))),
  );
  log(`since-filter: ${slices.length}/${before} slices touch the ${args.changedFiles.length} changed files`);
}

// Uncapped by design: review every slice and verify every finding, whatever the cost.
// (No budget-based slice trimming - run without a +Nk directive so there is no agent ceiling.)
if (slices.length === 0) {
  log("no slices to review - emitting an empty handoff");
}

// --- Phase 2: Review --------------------------------------------------------
phase("Review");
const reviewed = await parallel(
  slices.map((s) => () =>
    agent(reviewPrompt(s, root), {
      label: `review:${s.featureId}`,
      phase: "Review",
      model: "sonnet",
      schema: REVIEW_SCHEMA,
    }).then((r) => (r.findings || []).map((f) => ({ ...f, featureId: s.featureId, layer: s.layer }))),
  ),
);
const allFindings = reviewed.filter(Boolean).flat();
// BARRIER justified: dedup needs every finding at once to collapse cross-slice duplicates.
const deduped = dedupeBySignature(allFindings);
log(`review: ${allFindings.length} raw findings -> ${deduped.length} after cross-slice dedup`);

// --- Phase 3: Verify --------------------------------------------------------
phase("Verify");
const SURVIVE_THRESHOLD = Math.ceil(REFUTE_LENSES.length / 2); // 2 of 3 must NOT refute
const judged = await parallel(
  deduped.map((f) => () =>
    parallel(
      REFUTE_LENSES.map((lens) => () =>
        agent(refutePrompt(f, lens, root), {
          label: `verify:${slugify(f.title).slice(0, 24)}:${lens.key}`,
          phase: "Verify",
          model: "opus",
          schema: VERDICT_SCHEMA,
        }),
      ),
    ).then((votes) => {
      const v = votes.filter(Boolean);
      const notRefuted = v.filter((x) => !x.refuted).length;
      // Apply a downward severity correction agreed by any skeptic that still accepts it.
      const adj = v.map((x) => x.adjustedSeverity).filter(Boolean);
      const severity = adj.length ? adj.sort((a, b) => sevRank(a) - sevRank(b))[0] : f.severity;
      return { ...f, severity, survives: notRefuted >= SURVIVE_THRESHOLD, votes: v };
    }),
  ),
);
const confirmed = judged.filter(Boolean).filter((f) => f.survives);
const dropped = judged.filter(Boolean).filter((f) => !f.survives);
log(`verify: ${confirmed.length} confirmed, ${dropped.length} refuted (of ${deduped.length} deduped)`);

// --- Phase 4: Handoff -------------------------------------------------------
phase("Handoff");
const stats = { raw: allFindings.length, deduped: deduped.length, dropped: dropped.length, slices: slices.length };
const synth = await agent(synthPrompt(confirmed.map(compactFinding), stats, ids), {
  label: "handoff:synthesize",
  phase: "Handoff",
  model: "opus",
  schema: HANDOFF_SCHEMA,
});

// Assemble the final markdown: deterministic header + valid json block + human body.
// We serialize the handoff object ourselves so the embedded JSON is always valid.
const h = synth.handoff;
const header = [
  `# review-handoff.v1 - ${h.slug}`,
  ``,
  `branch: ${h.branch}`,
  `base: ${h.base}`,
  `reviewed_by: ${h.reviewed_by}`,
  `summary: ${h.summary.high} HIGH, ${h.summary.med} MED, ${h.summary.nit} NIT (HIGH blocks the PR)`,
  `generated: ${date} by /risoluto-clawpatch  |  ${stats.raw} raw -> ${stats.deduped} deduped -> ${confirmed.length} confirmed (${stats.dropped} refuted) across ${stats.slices} slices`,
].join("\n");
const jsonBlock = "```json\n" + JSON.stringify(h, null, 2) + "\n```";
const handoffMarkdown = `${header}\n\n${jsonBlock}\n\n${synth.markdown}\n`;

return { handoffMarkdown, handoff: h, stats };
