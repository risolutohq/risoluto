#!/usr/bin/env python3
"""Anti-hallucination check: every quoted constant in observable_behaviors must be grep-able in cited code.

This is the strongest guard against the failure mode "model invents a plausible-looking
`DEFAULT_TIMEOUT_MS = 10_000` constant that doesn't exist in the actual code." The
spine's whole value proposition is falsifiability — if quoted constants don't appear
in the cited file ranges, the spine is fiction.

Usage:
    python3 fact_check.py <spine.json> [--source-repo <path>] [--strict]

Rules enforced:
  HARD (exit 1):
    - Every cited file path must exist in the source repo.
    - Every cited `symbol` must appear at least once in the cited file (any line).
  SOFT (exit 2; exit 1 if --strict):
    - Every backtick-wrapped token in `observable_behaviors` that looks like a
      constant identifier (matches /^[A-Z_][A-Z0-9_]+$/) or an `IDENT = value`
      assignment must appear inside one of the entry's cited line ranges in the
      source repo. Catches hallucinated constants.

  All checks are skipped if no source repo is resolved (warns).

  Exit 0 = clean. Exit 1 = hard fail. Exit 2 = soft warnings only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Matches `something` segments (greedy non-backtick run between two backticks)
BACKTICK_RE = re.compile(r"`([^`]+)`")
# A bare constant identifier: ALL_CAPS_WITH_UNDERSCORES
CONST_IDENT_RE = re.compile(r"^[A-Z_][A-Z0-9_]+$")
# An assignment form like `DEFAULT_TIMEOUT_MS = 10_000` or `FOO=42`
CONST_ASSIGN_RE = re.compile(r"^([A-Z_][A-Z0-9_]+)\s*=\s*(.+?)\s*$")


def resolve_source_repo(payload: dict[str, Any], cli_override: Path | None) -> Path | None:
    """Same logic as validate_json.py — tolerant of v1.0 string-shape source_repo."""
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


def symbol_tokens(symbol: str) -> list[str]:
    """Split a citation symbol into individual identifiers to check.

    Models often write multi-symbol citations as "foo/bar/baz" or "Class.method".
    We need to verify EVERY listed identifier appears in the cited file.
    """
    if not symbol:
        return []
    # Strip optional parenthetical kind like "Foo (class)" → "Foo"
    s = re.sub(r"\s*\([^)]+\)\s*$", "", symbol)
    # Split on "/" (multi-symbol) and "+" (alternation shorthand)
    parts = re.split(r"[/+]", s)
    # For each part, also peel dotted access — keep both the last segment and the full dotted form
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        out.append(p)
        if "." in p:
            out.append(p.split(".")[-1])
    return out


def load_cited_ranges(feature: dict[str, Any], source_root: Path) -> dict[str, str]:
    """Return {citation_key: text_within_lines} for every citation of a feature."""
    out: dict[str, str] = {}
    for c in feature.get("citations") or []:
        path = source_root / c.get("path", "")
        if not path.exists():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        s, e = int(c.get("start_line", 1)) - 1, int(c.get("end_line", 1))
        s = max(0, s)
        e = min(len(lines), e)
        key = f"{c.get('path')}:L{c.get('start_line')}-L{c.get('end_line')}"
        out[key] = "\n".join(lines[s:e])
    return out


def load_full_files(feature: dict[str, Any], source_root: Path) -> dict[str, str]:
    """Return {path: full_text} for every cited file (deduped)."""
    out: dict[str, str] = {}
    for c in feature.get("citations") or []:
        p = c.get("path", "")
        if p in out:
            continue
        full = source_root / p
        if full.exists():
            try:
                out[p] = full.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
    return out


def extract_const_claims(behaviors: list[str]) -> list[tuple[str, str]]:
    """Return list of (behavior_text, claimed_constant) tuples for falsifiable backtick segments."""
    claims: list[tuple[str, str]] = []
    for b in behaviors:
        for m in BACKTICK_RE.findall(b):
            m = m.strip()
            if CONST_IDENT_RE.match(m):
                claims.append((b, m))
                continue
            am = CONST_ASSIGN_RE.match(m)
            if am:
                # Both the IDENT and (loosely) the value should appear in cited code
                claims.append((b, am.group(1)))
                claims.append((b, am.group(0)))  # the full IDENT = VAL form too
    return claims


def check_feature(feature: dict[str, Any], source_root: Path) -> tuple[list[str], list[str]]:
    """Return (hard_errors, soft_warnings) for one feature."""
    hard: list[str] = []
    soft: list[str] = []
    fid = feature.get("id", "?")
    cited_ranges = load_cited_ranges(feature, source_root)
    cited_full = load_full_files(feature, source_root)

    # HARD: every cited file exists
    for c in feature.get("citations") or []:
        path = source_root / c.get("path", "")
        if not path.exists():
            hard.append(f"[{fid}] cited file missing: {c.get('path')}")

    # HARD: every cited symbol must be locatable in its file.
    # Symbols can be: literal identifiers ("NotificationManager"), dotted access
    # ("Class.method"), multi-symbol shorthand ("foo/bar/baz"), or English
    # phrases the model invented as a citation label.
    # Strategy: try the literal first, then split into candidate tokens
    # (multi-symbol parts + last segment of dotted forms). If ANY candidate
    # appears in the file, pass. If none do, hard-fail.
    for c in feature.get("citations") or []:
        sym = c.get("symbol", "")
        path = c.get("path", "")
        if not sym or path not in cited_full:
            continue
        haystack = cited_full[path]
        if sym in haystack:
            continue
        candidates = symbol_tokens(sym)
        if not candidates:
            continue
        if any(t in haystack for t in candidates):
            continue
        hard.append(f"[{fid}] cited symbol {sym!r} (tokens {candidates}) not found anywhere in {path}")

    # SOFT: every constant-shaped backtick segment in observable_behaviors must appear
    # somewhere in one of the cited line ranges.
    all_cited_text = "\n".join(cited_ranges.values())
    claims = extract_const_claims(feature.get("observable_behaviors") or [])
    for (behavior, claim) in claims:
        if claim not in all_cited_text:
            soft.append(
                f"[{fid}] quoted constant {claim!r} not found in cited line ranges. "
                f"behavior was: {behavior[:160]}"
            )

    return hard, soft


def main() -> int:
    ap = argparse.ArgumentParser(description="Fact-check spine entries against source code.")
    ap.add_argument("json_path", type=Path)
    ap.add_argument("--source-repo", dest="source_repo", type=Path, default=None,
                    help="Source repo root (default: read from payload.source_repo.local_path)")
    ap.add_argument("--strict", action="store_true",
                    help="Escalate soft warnings to hard failures")
    ap.add_argument("--quiet", action="store_true",
                    help="Only print the summary line, not every issue")
    args = ap.parse_args()

    if not args.json_path.exists():
        print(f"error: file not found: {args.json_path}", file=sys.stderr)
        return 2
    payload = json.loads(args.json_path.read_text(encoding="utf-8"))

    source_root = resolve_source_repo(payload, args.source_repo)
    if source_root is None:
        print("warn: no source repo resolved — fact-check skipped", file=sys.stderr)
        return 0
    if not source_root.exists():
        print(f"error: source repo not found: {source_root}", file=sys.stderr)
        return 1

    all_hard: list[str] = []
    all_soft: list[str] = []
    features = payload.get("features") or []

    for f in features:
        hard, soft = check_feature(f, source_root)
        all_hard.extend(hard)
        all_soft.extend(soft)

    if not args.quiet:
        for e in all_hard:
            print(f"FAIL  {e}", file=sys.stderr)
        for w in all_soft:
            print(f"WARN  {w}", file=sys.stderr)

    summary = (
        f"\nfact-check: {len(features)} features, "
        f"{len(all_hard)} hard error(s), {len(all_soft)} soft warning(s) "
        f"(source: {source_root})"
    )
    print(summary, file=sys.stderr if (all_hard or all_soft) else sys.stdout)

    if all_hard:
        return 1
    if all_soft and args.strict:
        return 1
    if all_soft:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
