#!/usr/bin/env python3
"""Compute the diff between two RISOLUTO_FEATURES.json payloads.

Usage:
    python3 diff_spines.py --old <old.json> --new <new.json> \
        [--from-sha <sha>] [--to-sha <sha>] [--format markdown|json]

Default --format is "markdown", which prints the "Changed since last spine"
section ready to drop into RISOLUTO_FEATURES.md. With --format json, emits a
machine-readable diff payload to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def index(features: list[dict]) -> dict[str, dict]:
    return {f["id"]: f for f in features if "id" in f}


def diff_field_list(old_list: list[str], new_list: list[str]) -> dict[str, list[str]]:
    old_set = set(old_list or [])
    new_set = set(new_list or [])
    return {
        "added": sorted(new_set - old_set),
        "removed": sorted(old_set - new_set),
    }


def diff_citations(old_cits: list[dict], new_cits: list[dict]) -> dict[str, list[dict]]:
    """Cite-level diff keyed by (path, symbol). Line-range changes alone don't count."""

    def key(c: dict) -> tuple[str, str]:
        return (c.get("path", ""), c.get("symbol", ""))

    old_map = {key(c): c for c in (old_cits or [])}
    new_map = {key(c): c for c in (new_cits or [])}
    added = [c for k, c in new_map.items() if k not in old_map]
    removed = [c for k, c in old_map.items() if k not in new_map]
    relocated: list[dict] = []
    for k, nc in new_map.items():
        if k in old_map:
            oc = old_map[k]
            if (oc.get("start_line"), oc.get("end_line")) != (nc.get("start_line"), nc.get("end_line")):
                relocated.append({
                    "path": nc.get("path"),
                    "symbol": nc.get("symbol"),
                    "from": [oc.get("start_line"), oc.get("end_line")],
                    "to": [nc.get("start_line"), nc.get("end_line")],
                })
    return {"added": added, "removed": removed, "relocated": relocated}


def compute_diff(old_payload: dict, new_payload: dict) -> dict:
    old_features = index(old_payload.get("features") or [])
    new_features = index(new_payload.get("features") or [])

    added_ids = sorted(set(new_features) - set(old_features))
    removed_ids = sorted(set(old_features) - set(new_features))
    common_ids = set(old_features) & set(new_features)

    modified = []
    for fid in sorted(common_ids):
        old_f = old_features[fid]
        new_f = new_features[fid]
        changes: dict[str, Any] = {}

        # Compare scalar fields
        for k in ("name", "bundle", "description", "how_it_works", "tier", "confidence"):
            if old_f.get(k) != new_f.get(k):
                changes[k] = {"from": old_f.get(k), "to": new_f.get(k)}

        # Compare observable_behaviors as sets
        ob_diff = diff_field_list(old_f.get("observable_behaviors") or [], new_f.get("observable_behaviors") or [])
        if ob_diff["added"] or ob_diff["removed"]:
            changes["observable_behaviors"] = ob_diff

        # Compare citations
        cit_diff = diff_citations(old_f.get("citations") or [], new_f.get("citations") or [])
        if cit_diff["added"] or cit_diff["removed"] or cit_diff["relocated"]:
            changes["citations"] = cit_diff

        # Compare issues
        iss_diff = diff_field_list(
            [str(i) for i in old_f.get("issues") or []],
            [str(i) for i in new_f.get("issues") or []],
        )
        if iss_diff["added"] or iss_diff["removed"]:
            changes["issues"] = iss_diff

        if changes:
            modified.append({
                "id": fid,
                "name": new_f.get("name"),
                "bundle": new_f.get("bundle"),
                "fields_changed": sorted(changes.keys()),
                "diff": changes,
            })

    added = [{
        "id": fid,
        "name": new_features[fid].get("name"),
        "bundle": new_features[fid].get("bundle"),
        "issues": new_features[fid].get("issues") or [],
    } for fid in added_ids]

    removed = [{
        "id": fid,
        "name": old_features[fid].get("name"),
        "bundle": old_features[fid].get("bundle"),
    } for fid in removed_ids]

    return {
        "from_sha": old_payload.get("commit_sha"),
        "to_sha": new_payload.get("commit_sha"),
        "added": added,
        "modified": modified,
        "removed": removed,
    }


def render_markdown(d: dict, from_sha: str | None, to_sha: str | None) -> str:
    from_sha = from_sha or d.get("from_sha") or "—"
    to_sha = to_sha or d.get("to_sha") or "—"
    short_from = from_sha[:7] if from_sha else "—"
    short_to = to_sha[:7] if to_sha else "—"

    lines = [
        "## Changed since last spine",
        "",
        f"From `{short_from}` → `{short_to}` — **{len(d['added'])} added · {len(d['modified'])} modified · {len(d['removed'])} removed**.",
        "",
    ]

    def slug(s: str) -> str:
        import re
        return re.sub(r"-+|^-|-$", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")

    if d["added"]:
        lines += ["### Added", ""]
        for f in d["added"]:
            anchor = "#" + slug(f.get("name", ""))
            iss = " (" + ", ".join("#" + str(i) for i in f.get("issues") or []) + ")" if f.get("issues") else ""
            lines.append(f"- [{f.get('name')}]({anchor}) — _{f.get('bundle')}_{iss}")
        lines.append("")

    if d["modified"]:
        lines += ["### Modified", ""]
        for m in d["modified"]:
            anchor = "#" + slug(m.get("name", ""))
            fields = ", ".join(m.get("fields_changed") or [])
            lines.append(f"- [{m.get('name')}]({anchor}) — _{m.get('bundle')}_ — fields: `{fields}`")
        lines.append("")

    if d["removed"]:
        lines += ["### Removed", ""]
        for r in d["removed"]:
            lines.append(f"- **{r.get('name')}** (`{r.get('id')}`) — _{r.get('bundle')}_")
        lines.append("")

    if not d["added"] and not d["modified"] and not d["removed"]:
        lines.append("_No feature-level changes detected since the previous spine._")
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True, type=Path)
    ap.add_argument("--new", required=True, type=Path)
    ap.add_argument("--from-sha", default=None)
    ap.add_argument("--to-sha", default=None)
    ap.add_argument("--format", choices=["markdown", "json"], default="markdown")
    args = ap.parse_args()

    if not args.old.exists():
        # Cold start: just announce as "initial spine"
        new_payload = json.loads(args.new.read_text(encoding="utf-8"))
        if args.format == "json":
            print(json.dumps({"from_sha": None, "to_sha": new_payload.get("commit_sha"), "added": [], "modified": [], "removed": [], "cold_start": True}, indent=2))
        else:
            sha = (args.to_sha or new_payload.get("commit_sha") or "—")[:7]
            n = len(new_payload.get("features") or [])
            print("## Changed since last spine\n")
            print(f"_Initial spine cut at `{sha}` — **{n} features** recorded for the first time._\n")
        return 0

    old_payload = json.loads(args.old.read_text(encoding="utf-8"))
    new_payload = json.loads(args.new.read_text(encoding="utf-8"))
    d = compute_diff(old_payload, new_payload)

    if args.format == "json":
        print(json.dumps(d, indent=2, ensure_ascii=False))
    else:
        print(render_markdown(d, args.from_sha, args.to_sha))
    return 0


if __name__ == "__main__":
    sys.exit(main())
