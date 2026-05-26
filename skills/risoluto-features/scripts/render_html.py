#!/usr/bin/env python3
"""Hydrate the viewer-template.html with the JSON sidecar payload.

Usage:
    python3 render_html.py --json <path-to-RISOLUTO_FEATURES.json> --out <output-html>

Reads the JSON payload, replaces the `{{PAYLOAD_JSON}}` token in the bundled
template with the JSON (HTML-escaped where needed for safety in a <script>
tag), and writes the result to --out.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "assets" / "viewer-template.html"
PLACEHOLDER = "{{PAYLOAD_JSON}}"


def safe_for_script_tag(payload_str: str) -> str:
    """Escape sequences that would break out of a <script type="application/json"> tag.

    `</script>` inside the payload would prematurely close the tag. We split on
    `</` to neutralise it. Same for HTML comment open/close.
    """
    return (
        payload_str.replace("</", "<\\/")
                   .replace("<!--", "<\\!--")
                   .replace("-->", "--\\>")
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Render the RISOLUTO_FEATURES viewer HTML.")
    ap.add_argument("--json", required=True, type=Path, help="Path to RISOLUTO_FEATURES.json")
    ap.add_argument("--out", required=True, type=Path, help="Output path for the rendered HTML")
    ap.add_argument("--template", type=Path, default=TEMPLATE_PATH, help="Override template path")
    args = ap.parse_args()

    if not args.json.exists():
        print(f"error: JSON payload not found: {args.json}", file=sys.stderr)
        return 1
    if not args.template.exists():
        print(f"error: template not found: {args.template}", file=sys.stderr)
        return 1

    try:
        payload = json.loads(args.json.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON in {args.json}: {e}", file=sys.stderr)
        return 1

    template = args.template.read_text(encoding="utf-8")
    if PLACEHOLDER not in template:
        print(f"error: placeholder {PLACEHOLDER!r} not found in template", file=sys.stderr)
        return 1

    payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_str = safe_for_script_tag(payload_str)

    out_html = template.replace(PLACEHOLDER, payload_str)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(out_html, encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    feature_count = len(payload.get("features", []))
    print(f"wrote {args.out} ({size_kb:.1f} KiB, {feature_count} features)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
