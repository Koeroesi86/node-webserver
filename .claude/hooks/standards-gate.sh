#!/usr/bin/env bash
set -euo pipefail

# Blocks what CLAUDE.md forbids and eslint cannot see: commands (prettier --write, pushing to master, commenting on a PR, skipped checks)
# and, before a commit or push, files this branch adds that break the layout (kebab-case names, one function per utils file, a test next to it).
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

problems=""
while IFS= read -r file; do
  name="$(basename "$file")"
  case "$file" in *.ts) ;; *) continue ;; esac
  [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9-]+)*\.ts$ ]] || problems+="$file: new files are kebab-case"$'\n'
  [[ "$file" == */utils/* && "$name" != *.test.ts && "$name" != *.test-helper.ts ]] || continue
  [ "$(grep -cE '^export ' "$file")" = 1 ] || problems+="$file: one exported function per file in utils/"$'\n'
  [ -f "${file%.ts}.test.ts" ] || problems+="$file: no ${name%.ts}.test.ts next to it"$'\n'
done < <(git diff --name-only --diff-filter=A "$BASE" -- '*.ts'; git ls-files --others --exclude-standard -- '*.ts')

[ -z "$problems" ] || block "$(printf 'layout of CLAUDE.md:\n%s' "$problems")"
