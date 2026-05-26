<%*
// Templater: creates research/targets/<target>/sources/<source-slug>.md
// Fields required by research/.schemas/source.schema.json are pre-populated; fill the TODOs.
-%>
---
target: TODO-target-slug
source_type: article
url: https://TODO
captured_at: <% tp.date.now("YYYY-MM-DD") %>
captured_by: manual
ideas: []
---

# <% tp.file.title %>

> Pasted excerpt or summary from the source. Keep it under 30 lines — link to the canonical URL for the full text.

## Why this matters for Risoluto

TODO — one paragraph: what capability does this source show? Which target ships it?

## Quotes worth tagging

- TODO

## Open questions

- TODO
