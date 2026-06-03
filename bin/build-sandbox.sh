#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAG=${1:-latest}
exec docker build --pull -f "$SCRIPT_DIR/Dockerfile.sandbox" -t "risoluto-codex:$TAG" "$SCRIPT_DIR"
