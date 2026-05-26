#!/usr/bin/env python3
"""Markdown lint for the spine output.

Catches generation artifacts that the JSON validator can't see:
  - Duplicate consecutive H3 headings (same text, back-to-back)
  - Stray template tokens (`{{...}}`)
  - Orphan `Evidence:` blocks with zero citations
  - Citation lines that don't match the expected shape

Usage:
    python3 lint_md.py <RISOLUTO_FEATURES.md>

Exit 0 = clean. Exit 1 = lint errors.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

H3_RE = re.compile(r"^###\s+(.+?)\s*$")
TEMPLATE_TOKEN_RE = re.compile(r"\{\{[^}]+\}\}")
CITATION_LINE_RE = re.compile(r"^\s*-\s+Source:\s+`[^`]+:L\d+(?:-L\d+)?`\s+—\s+`[^`]+`")


def lint(text: str) -> list[tuple[int, str]]:
    """Return list of (line_number, message) lint findings."""
    findings: list[tuple[int, str]] = []
    lines = text.splitlines()

    # Duplicate consecutive H3
    last_h3 = None
    last_h3_line = -1
    for i, line in enumerate(lines, start=1):
        m = H3_RE.match(line)
        if not m:
            # Reset only on non-empty, non-H3 lines (so blank lines between dupes still trigger)
            if line.strip() and not line.startswith("#"):
                last_h3 = None
            continue
        title = m.group(1).strip()
        if title == last_h3 and (i - last_h3_line) <= 5:
            findings.append((i, f"duplicate consecutive H3: {title!r} (previously at line {last_h3_line})"))
        last_h3 = title
        last_h3_line = i

    # Stray template tokens
    for i, line in enumerate(lines, start=1):
        for tok in TEMPLATE_TOKEN_RE.findall(line):
            findings.append((i, f"unsubstituted template token: {tok}"))

    # Citation-line shape check (only inside Evidence blocks)
    in_evidence = False
    evidence_start = -1
    evidence_citation_count = 0
    for i, line in enumerate(lines, start=1):
        if line.strip().startswith("- **Evidence:"):
            if in_evidence and evidence_citation_count < 2:
                findings.append((evidence_start, f"Evidence block had only {evidence_citation_count} citation(s) — expected ≥2"))
            in_evidence = True
            evidence_start = i
            evidence_citation_count = 0
            continue
        if in_evidence:
            stripped = line.lstrip()
            if stripped.startswith("- Source:"):
                evidence_citation_count += 1
                if not CITATION_LINE_RE.match(line):
                    findings.append((i, "citation line doesn't match expected shape `- Source: \\`path:Lx-Ly\\` — \\`Symbol\\`"))
            elif stripped.startswith("- **") or stripped.startswith("---") or stripped.startswith("### "):
                if evidence_citation_count < 2:
                    findings.append((evidence_start, f"Evidence block had only {evidence_citation_count} citation(s) — expected ≥2"))
                in_evidence = False
    if in_evidence and evidence_citation_count < 2:
        findings.append((evidence_start, f"Evidence block had only {evidence_citation_count} citation(s) — expected ≥2"))

    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("md_path", type=Path)
    args = ap.parse_args()

    if not args.md_path.exists():
        print(f"error: file not found: {args.md_path}", file=sys.stderr)
        return 2

    text = args.md_path.read_text(encoding="utf-8")
    findings = lint(text)

    if findings:
        for line_no, msg in findings:
            print(f"{args.md_path}:{line_no}: {msg}", file=sys.stderr)
        print(f"\nlint: {len(findings)} finding(s)", file=sys.stderr)
        return 1

    print(f"ok: {args.md_path} (lint clean)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
