---
view: untagged-sources
description: Sources whose `ideas:` frontmatter is empty — they haven't been triaged yet. The synthesizer ignores them until at least one tag lands.
---

# Untagged sources

Captured material that still needs at least one `ideas:` tag before the synthesizer will roll it into an idea cluster.

```dataview
TABLE
  target AS "Target",
  source_type AS "Type",
  captured_at AS "Captured",
  url AS "URL"
FROM "targets"
WHERE file.name != "README"
  AND (length(ideas) = 0 OR !ideas)
SORT captured_at ASC
```
