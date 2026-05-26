#!/usr/bin/env python3
"""Compute the Summary table and Coverage manifest markdown from the JSON sidecar.

Usage:
    python3 render_meta.py --json <path> --section summary
    python3 render_meta.py --json <path> --section coverage --repo <path-to-repo>

Both sections are derived mechanically from features[] and coverage[]. The
Coverage manifest needs --repo to enumerate src/ modules and check whether each
has any citing features.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def render_summary(payload: dict) -> str:
    features = payload.get("features") or []
    bundles = payload.get("bundles") or []
    by_bundle: Counter[str] = Counter(f.get("bundle", "?") for f in features)
    by_confidence: Counter[str] = Counter(f.get("confidence", "high") for f in features)

    rows = ["| Bundle | Feature count |", "| --- | ---: |"]
    for b in bundles:
        rows.append(f"| {b} | {by_bundle.get(b, 0)} |")
    rows.append(f"| **Total** | **{len(features)}** |")

    lines = ["## Summary", ""]
    lines.extend(rows)
    lines += [
        "",
        "**Confidence split:**",
        "",
        f"- **High confidence:** {by_confidence.get('high', 0)} entries.",
        f"- **Medium confidence:** {by_confidence.get('medium', 0)} entries.",
        f"- **Low confidence:** {by_confidence.get('low', 0)} entries.",
        "",
    ]
    return "\n".join(lines)


def render_coverage(payload: dict, repo_root: Path | None) -> str:
    """Derive per-module coverage from features[].citations[].path.

    If repo_root is provided, enumerate src/ subdirectories so plumbing-only
    modules are surfaced too. Otherwise only modules that have at least one
    feature citation appear.
    """
    features = payload.get("features") or []

    # Group citations by module (first two path segments: src/<module>/...)
    module_features: dict[str, set[str]] = {}
    for f in features:
        fid = f.get("id", "")
        for c in f.get("citations") or []:
            path = c.get("path", "")
            parts = path.split("/")
            if len(parts) >= 2 and parts[0] in ("src", "frontend"):
                module = parts[0] + "/" + parts[1] + "/"
            else:
                continue
            module_features.setdefault(module, set()).add(fid)

    # Enumerate from repo if provided so plumbing-only modules show as 0
    all_modules: set[str] = set(module_features.keys())
    if repo_root and repo_root.exists():
        src_root = repo_root / "src"
        if src_root.exists():
            for sub in src_root.iterdir():
                if sub.is_dir():
                    all_modules.add(f"src/{sub.name}/")
        if (repo_root / "frontend" / "src").exists():
            all_modules.add("frontend/src/")

    # Preserve hand-written notes from existing payload if available
    existing = {row.get("module"): row for row in payload.get("coverage") or []}

    rows = ["| Module | Feature count cited | Export accounting | Notes |", "| --- | ---: | --- | --- |"]
    for mod in sorted(all_modules):
        count = len(module_features.get(mod, set()))
        existing_row = existing.get(mod, {})
        kind = existing_row.get("kind") or ("feature + plumbing" if count > 0 else "plumbing only")
        note = existing_row.get("note") or ""
        rows.append(f"| `{mod}` | {count} | {kind} | {note} |")

    lines = ["## Coverage manifest", ""]
    lines.append(
        "One row per actual `src/<module>/` directory plus one row for `frontend/src/`. "
        "Rows with `0` cited features are plumbing-only modules in this spine."
    )
    lines.append("")
    lines.extend(rows)
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, type=Path)
    ap.add_argument("--section", required=True, choices=["summary", "coverage"])
    ap.add_argument("--repo", type=Path, default=None)
    args = ap.parse_args()

    if not args.json.exists():
        print(f"error: JSON not found: {args.json}", file=sys.stderr)
        return 1
    payload = json.loads(args.json.read_text(encoding="utf-8"))

    if args.section == "summary":
        print(render_summary(payload))
    else:
        print(render_coverage(payload, args.repo))
    return 0


if __name__ == "__main__":
    sys.exit(main())
