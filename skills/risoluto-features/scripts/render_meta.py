#!/usr/bin/env python3
"""Derive the Summary table and Coverage manifest from the JSON sidecar.

Usage:
    # Print markdown for the .md body:
    python3 render_meta.py --json <path> --section summary
    python3 render_meta.py --json <path> --section coverage --repo <path-to-source-repo>

    # Persist derived summary + coverage back INTO the JSON sidecar (in place) so the
    # HTML viewer and any JSON consumer can render them. Without this, the coverage
    # table renders empty even though the .md shows the manifest:
    python3 render_meta.py --json <path> --write --repo <path-to-source-repo>

Both sections are derived mechanically from features[] and coverage[]. The Coverage
manifest needs --repo to enumerate src/ modules so plumbing-only modules (no citing
features) are surfaced too. When --repo is absent, previously-recorded coverage modules
are preserved so those rows are not silently dropped.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def _module_feature_counts(payload: dict) -> dict[str, set[str]]:
    """Group feature ids by module (first two path segments: src/<module>/...)."""
    module_features: dict[str, set[str]] = {}
    for f in payload.get("features") or []:
        fid = f.get("id", "")
        for c in f.get("citations") or []:
            parts = c.get("path", "").split("/")
            if len(parts) >= 2 and parts[0] in ("src", "frontend"):
                module = parts[0] + "/" + parts[1] + "/"
                module_features.setdefault(module, set()).add(fid)
    return module_features


def compute_summary(payload: dict) -> dict:
    """Return the summary object: per-bundle counts, total, confidence split."""
    features = payload.get("features") or []
    bundles = payload.get("bundles") or []
    by_bundle: Counter[str] = Counter(f.get("bundle", "?") for f in features)
    by_confidence: Counter[str] = Counter(f.get("confidence", "high") for f in features)
    return {
        "by_bundle": {b: by_bundle.get(b, 0) for b in bundles},
        "total": len(features),
        "confidence": {
            "high": by_confidence.get("high", 0),
            "medium": by_confidence.get("medium", 0),
            "low": by_confidence.get("low", 0),
        },
    }


def compute_coverage(payload: dict, repo_root: Path | None) -> list[dict]:
    """Return the coverage manifest as a list of {module, feature_count, kind, note}.

    Module list = citation-derived modules, plus (when --repo is given) every actual
    src/<module>/ directory so plumbing-only modules show as 0. Hand-written `kind` and
    `note` values from the existing payload are preserved.
    """
    module_features = _module_feature_counts(payload)
    existing = {row.get("module"): row for row in payload.get("coverage") or []}

    all_modules: set[str] = set(module_features.keys())
    if repo_root and repo_root.exists():
        src_root = repo_root / "src"
        if src_root.exists():
            for sub in src_root.iterdir():
                if sub.is_dir():
                    all_modules.add(f"src/{sub.name}/")
        if (repo_root / "frontend" / "src").exists():
            all_modules.add("frontend/src/")
    else:
        # No source repo to enumerate: keep previously-recorded modules (incl.
        # plumbing-only rows that have no citations) so they are not lost.
        all_modules |= set(existing.keys())

    rows: list[dict] = []
    for mod in sorted(all_modules):
        count = len(module_features.get(mod, set()))
        existing_row = existing.get(mod, {})
        kind = existing_row.get("kind") or ("feature + plumbing" if count > 0 else "plumbing only")
        note = existing_row.get("note") or ""
        rows.append({"module": mod, "feature_count": count, "kind": kind, "note": note})
    return rows


def render_summary(payload: dict) -> str:
    s = compute_summary(payload)
    rows = ["| Bundle | Feature count |", "| --- | ---: |"]
    for b in payload.get("bundles") or []:
        rows.append(f"| {b} | {s['by_bundle'].get(b, 0)} |")
    rows.append(f"| **Total** | **{s['total']}** |")

    lines = ["## Summary", ""]
    lines.extend(rows)
    lines += [
        "",
        "**Confidence split:**",
        "",
        f"- **High confidence:** {s['confidence']['high']} entries.",
        f"- **Medium confidence:** {s['confidence']['medium']} entries.",
        f"- **Low confidence:** {s['confidence']['low']} entries.",
        "",
    ]
    return "\n".join(lines)


def render_coverage(payload: dict, repo_root: Path | None) -> str:
    rows = compute_coverage(payload, repo_root)
    table = ["| Module | Feature count cited | Export accounting | Notes |", "| --- | ---: | --- | --- |"]
    for r in rows:
        table.append(f"| `{r['module']}` | {r['feature_count']} | {r['kind']} | {r['note']} |")

    lines = ["## Coverage manifest", ""]
    lines.append(
        "One row per actual `src/<module>/` directory plus one row for `frontend/src/`. "
        "Rows with `0` cited features are plumbing-only modules in this spine."
    )
    lines.append("")
    lines.extend(table)
    lines.append("")
    return "\n".join(lines)


def write_meta_into_json(json_path: Path, payload: dict, repo_root: Path | None) -> int:
    """Persist derived summary + coverage into the JSON sidecar, in place."""
    payload["summary"] = compute_summary(payload)
    payload["coverage"] = compute_coverage(payload, repo_root)
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote summary + {len(payload['coverage'])} coverage rows into {json_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, type=Path)
    ap.add_argument("--section", choices=["summary", "coverage"], default=None)
    ap.add_argument("--repo", type=Path, default=None)
    ap.add_argument(
        "--write",
        action="store_true",
        help="Persist derived summary + coverage into the JSON sidecar in place (instead of printing).",
    )
    args = ap.parse_args()

    if not args.json.exists():
        print(f"error: JSON not found: {args.json}", file=sys.stderr)
        return 1
    payload = json.loads(args.json.read_text(encoding="utf-8"))

    if args.write:
        return write_meta_into_json(args.json, payload, args.repo)

    if not args.section:
        print("error: one of --section {summary,coverage} or --write is required", file=sys.stderr)
        return 1
    if args.section == "summary":
        print(render_summary(payload))
    else:
        print(render_coverage(payload, args.repo))
    return 0


if __name__ == "__main__":
    sys.exit(main())
