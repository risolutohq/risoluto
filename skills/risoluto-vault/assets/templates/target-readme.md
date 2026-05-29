<%*
// Templater: creates research/targets/<slug>/README.md
// `ideas`, `last_researched_*`, and `source_count` are derived by risoluto-researcher on each run — leave the placeholders, the skill overwrites them.
-%>
---
slug: TODO-target-slug
canonical_url: https://TODO
category: peer
last_researched_at: <% tp.date.now("YYYY-MM-DD") %>
last_researched_sha: pending
ideas: []
source_count: 0
---

# <% tp.file.title %>

## What is this target?

TODO — one paragraph: who they are, what they ship, why we're tracking them.

## Capabilities observed

TODO — bullet list of capabilities seen in `sources/`. The risoluto-researcher derives frontmatter `ideas:` from the tags on each source file; risoluto-ingest clusters those tags into the research wiki. This prose section is the human-readable summary.

## Candidate features

<!-- Populated by /risoluto-researcher. Each entry carries the AFK job it serves (the value lens — see docs/product-spine.md) and a dedup verdict (skip | merge | supersede | new). A candidate that serves no AFK job belongs under Leech takeaways. Do not hand-edit — the researcher overwrites this section. -->

## Leech takeaways

<!-- Populated by /risoluto-researcher. Strategic patterns and positioning insights to borrow from this target. Do not hand-edit — the researcher overwrites this section. -->

## Sources

See `sources/*.md`. Add new ones via Obsidian's Web Clipper or `/risoluto-researcher <url>`.

## Analyst notes

TODO — operator-owned. Not regenerated.
