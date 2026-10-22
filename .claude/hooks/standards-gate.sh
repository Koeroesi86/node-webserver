#!/usr/bin/env bash
set -euo pipefail

# Blocks what CLAUDE.md forbids and eslint cannot see: commands (prettier --write, pushing to master, commenting on a PR, skipped checks)
# and, before a commit or push, files this branch adds that break the layout (tools/src/scripts/check-layout.ts, which CI runs too).
# Needs jq; without it the gate skips, like fallow-gate.sh.

command -v jq >/dev/null 2>&1 || exit 0

CMD="$(jq -r '.tool_input.command // empty' <<<"$(cat)")"
[ -n "$CMD" ] || exit 0

block() {
  echo "standards-gate: $1" >&2
  exit 2
}

grep -qE 'prettier( |.* )--write' <<<"$CMD" && block "never run prettier --write, it ignores the 160 columns; use pnpm exec eslint --fix <paths>."
grep -qE 'gh +pr +(comment|review)' <<<"$CMD" && block "do not comment on pull requests; update the description with gh pr edit --body-file."
grep -qE 'git +(commit|push).*--no-verify' <<<"$CMD" && block "do not skip the hooks; find out why they fail."
grep -qE 'git +push.*( |:)master( |$)' <<<"$CMD" && block "never push to master."

grep -qE '(^|[;&| ])git +(-[^ ]+ +[^ ]+ +)*(commit|push)' <<<"$CMD" || exit 0

BASE="$(git merge-base HEAD origin/master 2>/dev/null || true)"
[ -n "$BASE" ] || exit 0

# the same check as the layout job of CI, from the build of the tools (without node or the build the gate skips)
command -v node >/dev/null 2>&1 && [ -f tools/dist/scripts/check-layout.js ] || exit 0
problems="$(node tools/dist/scripts/check-layout.js "$BASE" 2>&1 || true)"

[ -z "$problems" ] || block "$problems"
