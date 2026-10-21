#!/usr/bin/env bash
set -euo pipefail

# Fixes the formatting of a typescript file Claude just wrote with eslint (prettier through it), as CLAUDE.md asks, never prettier --write.
# Needs jq and pnpm on the PATH; without them it skips. Findings it cannot fix are left to pnpm lint.

command -v jq >/dev/null 2>&1 || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0

FILE="$(jq -r '.tool_input.file_path // empty' <<<"$(cat)")"
case "$FILE" in *.ts) ;; *) exit 0 ;; esac
case "$FILE" in "$CLAUDE_PROJECT_DIR"/*) ;; *) exit 0 ;; esac

cd "$CLAUDE_PROJECT_DIR"
pnpm exec eslint --fix "$FILE" >/dev/null 2>&1 || true
