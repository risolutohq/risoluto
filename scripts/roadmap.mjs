/**
 * Shared helper for reading and surgically editing the roadmap table in
 * `docs/roadmap.md`. Used by every pipeline script that touches the roadmap:
 *   - skills/risoluto-ingest/scripts/ingest.mjs        (append idea rows)
 *   - skills/risoluto-grill/scripts/grill-write.mjs    (append + edit rows)
 *   - skills/risoluto-to-prd/scripts/write.mjs         (flip next -> building, stamp Linear)
 *   - scripts/post-merge-prd.mjs                       (flip -> shipped)
 *   - scripts/validate-research.ts                     (slug-consistency, via parse only)
 *
 * The roadmap is the single ordered plan and the join key for the pipeline.
 * The table lives under the "## The plan" heading with the locked 6-column spec:
 *
 *   | # | Item | Why now | Size | Status | Research link |
 *
 * The slug is carried as an HTML comment in the Item cell: `Title <!-- slug:<slug> -->`.
 * It is the join key (roadmap row <-> PRD filename <-> prd.slug <-> Linear from:prd-<slug>).
 *
 * .mjs is OXLint-exempt by repo config; keep the code small and pure anyway.
 */

export const ROADMAP_HEADERS = ["#", "Item", "Why now", "Size", "Status", "Research link"];
export const ROADMAP_STATUSES = ["idea", "next", "building", "shipped", "dropped", "superseded"];

const SLUG_MARKER_RE = /<!--\s*slug:([a-z0-9][a-z0-9-]*)\s*-->/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Split a markdown table line into trimmed cell values (drops the leading/trailing empties). */
function splitCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableLine(line) {
  return line.trim().startsWith("|");
}

function isSeparatorLine(line) {
  return /^\|[\s:|-]+\|$/.test(line.trim()) && line.includes("-");
}

/** True when the row carries no real content (the empty placeholder row). */
function isPlaceholderRow(cells) {
  return cells.every((c) => c.length === 0);
}

/** Extract the slug from an Item cell, or null when no marker is present. */
export function slugFromItem(itemCell) {
  const match = itemCell.match(SLUG_MARKER_RE);
  return match ? match[1] : null;
}

/**
 * Parse the roadmap file into a structured model.
 * @returns {{ found: boolean, before: string[], after: string[], rows: Array<{ cells: string[], slug: string|null }> }}
 */
export function parseRoadmap(raw) {
  const lines = raw.split("\n");
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!isTableLine(lines[i])) continue;
    const cells = splitCells(lines[i]);
    if (cells.length === ROADMAP_HEADERS.length && cells.every((c, j) => c === ROADMAP_HEADERS[j])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return { found: false, before: lines, after: [], rows: [] };
  }
  const sepIdx = headerIdx + 1;
  if (sepIdx >= lines.length || !isSeparatorLine(lines[sepIdx])) {
    return { found: false, before: lines, after: [], rows: [] };
  }
  let end = sepIdx + 1;
  const rows = [];
  while (end < lines.length && isTableLine(lines[end])) {
    const cells = splitCells(lines[end]);
    if (!isPlaceholderRow(cells)) {
      rows.push({ cells, slug: slugFromItem(cells[1] ?? "") });
    }
    end += 1;
  }
  return {
    found: true,
    before: lines.slice(0, headerIdx),
    after: lines.slice(end),
    rows,
  };
}

/** Find a row by its slug marker. Returns the row object (mutable) or null. */
export function findRowBySlug(model, slug) {
  return model.rows.find((r) => r.slug === slug) ?? null;
}

/** Build an Item cell that carries the slug marker (idempotent if already present). */
function itemWithSlug(item, slug) {
  return SLUG_MARKER_RE.test(item) ? item : `${item} <!-- slug:${slug} -->`;
}

/**
 * Append an `idea` (or `next`) row. Idempotent by slug: if a row with the slug
 * already exists it is left untouched and `{ added: false }` is returned.
 */
export function appendRow(model, { slug, item, whyNow = "", size = "", status = "idea", researchLink = "—" }) {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug: ${slug}`);
  if (findRowBySlug(model, slug)) return { added: false };
  model.rows.push({
    cells: ["", itemWithSlug(item, slug), whyNow, size, status, researchLink],
    slug,
  });
  return { added: true };
}

/** Set a single cell (by column header name) on the row with the given slug. */
export function setCell(model, slug, header, value) {
  const idx = ROADMAP_HEADERS.indexOf(header);
  if (idx === -1) throw new Error(`unknown roadmap column: ${header}`);
  const row = findRowBySlug(model, slug);
  if (!row) return { changed: false };
  if (row.cells[idx] === value) return { changed: false };
  row.cells[idx] = value;
  return { changed: true };
}

/**
 * Set the Status cell. When `link` is given the status renders as a markdown link
 * (`[building](https://linear.app/...)`), which is how `next -> building` stamps the
 * Linear project and how `-> shipped` may point at the decision/PR.
 */
export function setStatus(model, slug, status, link = null) {
  const value = link ? `[${status}](${link})` : status;
  return setCell(model, slug, "Status", value);
}

/** Render a GFM table with prettier-compatible column alignment (padded to max width). */
function renderTable(rows) {
  const data = rows.length > 0 ? rows.map((r) => r.cells) : [ROADMAP_HEADERS.map(() => "")];
  const widths = ROADMAP_HEADERS.map((h, i) => Math.max(h.length, ...data.map((cells) => (cells[i] ?? "").length), 3));
  const renderRow = (cells) => `| ${ROADMAP_HEADERS.map((_, i) => (cells[i] ?? "").padEnd(widths[i])).join(" | ")} |`;
  const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  return [renderRow(ROADMAP_HEADERS), separator, ...data.map(renderRow)].join("\n");
}

/** Re-render the whole roadmap file, preserving everything outside the plan table. */
export function renderRoadmap(model) {
  if (!model.found) throw new Error("roadmap plan table not found — cannot render");
  return [...model.before, renderTable(model.rows), ...model.after].join("\n");
}
