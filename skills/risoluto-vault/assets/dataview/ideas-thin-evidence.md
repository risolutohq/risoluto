---
view: ideas-thin-evidence
description: Ideas with fewer than two evidence targets — single-source ideas are speculation, not patterns.
---

# Ideas with <2 evidence targets

The synthesizer creates an idea row even with a single evidence target so nothing falls through, but a one-target idea isn't a cluster — it's a hunch. Use this view to either find a second corroborating target or to mark the idea `dropped` in `capability-backlog.md`.

```dataview
TABLE
  length(evidence_targets) AS "Targets",
  evidence_targets AS "Names",
  linear_project AS "Linear",
  prd_file AS "PRD"
FROM "ideas"
WHERE file.name = "README"
  AND length(evidence_targets) < 2
SORT length(evidence_targets) ASC, slug ASC
```
