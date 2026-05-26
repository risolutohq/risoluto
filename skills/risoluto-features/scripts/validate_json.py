#!/usr/bin/env python3
"""Validate RISOLUTO_FEATURES.json against the schema rules.

Usage:
    python3 validate_json.py <path-to-json> [--repo <path-to-repo>]

Exit codes:
    0 = valid
    1 = validation errors (printed to stderr)
    2 = file unreadable / not JSON

The validator enforces every rule in references/json-schema.md "Validation rules".
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
ACCEPTED_SCHEMA_VERSIONS = {"1.0", "1.1"}


def err(errors: list[str], msg: str) -> None:
    errors.append(msg)


def resolve_source_repo(payload: dict[str, Any], cli_override: Path | None) -> Path | None:
    """Pick the source repo path for citation existence checks.

    Priority: CLI override > payload.source_repo.local_path > None (skip path checks).
    The local_path is interpreted relative to cwd, or absolute.

    Tolerates v1.0 payloads where source_repo is a bare string identifier
    (e.g., "risolutohq/risoluto") with no local path — returns None in that case.
    """
    if cli_override is not None:
        return cli_override
    src = payload.get("source_repo")
    if not isinstance(src, dict):
        return None
    lp = src.get("local_path")
    if not lp:
        return None
    p = Path(lp)
    return p if p.is_absolute() else (Path.cwd() / p)


def validate(payload: dict[str, Any], repo_root: Path | None) -> list[str]:
    errors: list[str] = []

    sv = payload.get("schema_version")
    if sv not in ACCEPTED_SCHEMA_VERSIONS:
        err(errors, f"schema_version must be one of {sorted(ACCEPTED_SCHEMA_VERSIONS)}, got {sv!r}")

    commit_sha = payload.get("commit_sha", "")
    if not (isinstance(commit_sha, str) and SHA_RE.match(commit_sha)):
        err(errors, f"commit_sha must be 40 lowercase hex chars, got {commit_sha!r}")

    prev_sha = payload.get("previous_commit_sha")
    if prev_sha is not None and not (isinstance(prev_sha, str) and SHA_RE.match(prev_sha)):
        err(errors, f"previous_commit_sha must be null or 40 hex chars, got {prev_sha!r}")

    bundles = payload.get("bundles") or []
    if not isinstance(bundles, list) or not all(isinstance(b, str) for b in bundles):
        err(errors, "bundles must be a list of strings")

    bundle_set = set(bundles) if isinstance(bundles, list) else set()
    features = payload.get("features") or []
    if not isinstance(features, list):
        err(errors, "features must be a list")
        return errors

    seen_ids: set[str] = set()
    used_bundles: set[str] = set()

    for i, f in enumerate(features):
        loc = f"features[{i}]"
        fid = f.get("id", "")
        if not (isinstance(fid, str) and ID_RE.match(fid)):
            err(errors, f"{loc}.id invalid (must match ^[a-z0-9][a-z0-9-]*$): {fid!r}")
        if fid in seen_ids:
            err(errors, f"{loc}.id duplicated: {fid!r}")
        seen_ids.add(fid)

        b = f.get("bundle", "")
        if b not in bundle_set:
            err(errors, f"{loc}.bundle {b!r} not in top-level bundles[]")
        used_bundles.add(b)

        cits = f.get("citations") or []
        if not isinstance(cits, list) or len(cits) < 2:
            err(errors, f"{loc}.citations must have at least 2 entries")
            continue

        for j, c in enumerate(cits):
            cloc = f"{loc}.citations[{j}]"
            path = c.get("path", "")
            sl = c.get("start_line")
            el = c.get("end_line")
            sym = c.get("symbol", "")
            if not isinstance(path, str) or not path:
                err(errors, f"{cloc}.path must be a non-empty string")
            if not (isinstance(sl, int) and isinstance(el, int) and sl > 0 and el > 0 and sl <= el):
                err(errors, f"{cloc} line range invalid: start_line={sl} end_line={el}")
            if not isinstance(sym, str) or not sym:
                err(errors, f"{cloc}.symbol must be a non-empty string")
            if repo_root is not None and isinstance(path, str):
                fp = repo_root / path
                if not fp.exists():
                    err(errors, f"{cloc}.path does not exist in repo: {path}")

    summary = payload.get("summary") or {}
    total = summary.get("total")
    if total != len(features):
        err(errors, f"summary.total={total} does not equal len(features)={len(features)}")

    by_bundle = summary.get("by_bundle") or {}
    if set(by_bundle.keys()) != used_bundles:
        missing = used_bundles - set(by_bundle.keys())
        extra = set(by_bundle.keys()) - used_bundles
        if missing:
            err(errors, f"summary.by_bundle missing keys: {sorted(missing)}")
        if extra:
            err(errors, f"summary.by_bundle has extra keys not in features: {sorted(extra)}")

    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("json_path", type=Path)
    ap.add_argument("--source-repo", "--repo", dest="source_repo", type=Path, default=None,
                    help="Source repo root for citation path checks (default: read from payload.source_repo.local_path)")
    args = ap.parse_args()

    if not args.json_path.exists():
        print(f"error: file not found: {args.json_path}", file=sys.stderr)
        return 2
    try:
        payload = json.loads(args.json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON: {e}", file=sys.stderr)
        return 2

    source_repo = resolve_source_repo(payload, args.source_repo)
    if source_repo is None:
        print("note: no source repo resolved — citation paths will not be existence-checked", file=sys.stderr)
    elif not source_repo.exists():
        print(f"error: source repo path does not exist: {source_repo}", file=sys.stderr)
        return 2

    errors = validate(payload, source_repo)
    if errors:
        for e in errors:
            print(f"validation: {e}", file=sys.stderr)
        print(f"\n{len(errors)} validation error(s)", file=sys.stderr)
        return 1

    n = len(payload.get('features', []))
    src_note = f", checked against {source_repo}" if source_repo else ""
    print(f"ok: {args.json_path} ({n} features, schema v{payload.get('schema_version')}{src_note})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
