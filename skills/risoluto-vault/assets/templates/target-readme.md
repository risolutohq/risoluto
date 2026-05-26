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

TODO — bullet list of capabilities seen in `sources/`. The risoluto-researcher / risoluto-synthesizer skills derive frontmatter `ideas:` from the tags on each source file; this prose section is the human-readable summary.

## Sources

See `sources/*.md`. Add new ones via Obsidian's Web Clipper or `/risoluto-researcher <url>`.

## Analyst notes

TODO — operator-owned. Not regenerated.
