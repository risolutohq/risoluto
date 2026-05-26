---
view: targets-stale
description: Targets not refreshed in 90 days — their `last_researched_at` is older than the freshness window.
---

# Targets not refreshed in 90 days

Re-run `/risoluto-researcher <slug>` against these targets to refresh `last_researched_at` and pick up new sources the project may have shipped since last sweep.

```dataview
TABLE
  category AS "Category",
  last_researched_at AS "Last refresh",
  source_count AS "Sources",
  canonical_url AS "URL"
FROM "targets"
WHERE file.name = "README"
  AND date(today) - date(last_researched_at) > dur(90 days)
SORT last_researched_at ASC
```
