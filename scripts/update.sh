#!/usr/bin/env bash
# Regenerates _agy from the help output of an installed Antigravity CLI.
# Usage: scripts/update.sh [path to agy]   (defaults to the agy on PATH)

set -euo pipefail

binary="${1:-agy}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

node "$root/scripts/generate.mjs" "$binary" > "$workdir/_agy"
zsh -n "$workdir/_agy"

mv "$workdir/_agy" "$root/_agy"
"$binary" --version > "$root/agy-version" 2>&1

echo "Generated _agy for agy $(cat "$root/agy-version")"
