---
name: open-pr
description: Open a pull request for the current branch with the repository template filled in, the packages that publish worked out, and only the checks that were run ticked. Trigger "open pr", "create pr", "/open-pr".
allowed-tools: Read, Bash
---

Open a pull request for the current branch, applying the rules of `CLAUDE.md` in this order.

## Before pushing
1. Refuse on `master`. The branch must come off `master` and hold one change; if more, say so and stop.
2. Changed files: `git diff --name-only origin/master...HEAD`.
3. Stacked on another branch: use it as `--base` and say so in "What and why".

## Which packages publish
A change in `packages/<name>/**` or `pnpm-lock.yaml` publishes that package and its dependents:

| Changed | Publishes |
|---|---|
| `node-worker` | `node-worker`, `node-worker-express`, `node-webserver`, `node-webserver-cli`, `node-webserver-service` |
| `node-worker-express`, `node-lambda-invoke` | itself, `node-webserver`, `node-webserver-cli`, `node-webserver-service` |
| `node-webserver` | itself, `node-webserver-cli`, `node-webserver-service` |
| `node-webserver-cli`, `node-webserver-service` | itself |
| `pnpm-lock.yaml` | packages whose dependencies changed, plus their dependents |

Check the table against the `workspace:*` dependencies (it goes stale), and say whether the change is breaking. Only `tools/`, docs or `.github/` publishes nothing: delete Release.

## Body
Fill `.github/pull_request_template.md` section by section:
- **What and why**: a few sentences; `Closes #N` (`gh issue view N`) or the PR it is stacked on.
- **Changes**: one line each.
- **Behaviour changes**: config, API, defaults, output users notice; delete if none.
- **Release**: packages above, breaking or not.
- **Verification**: tick only what ran this session, after reading the output. `pnpm lint`, `build`, `quality`/`test`, `test:integration` are one box: all four must pass. The load test is required when the request path changed; CI counts only once it has run.
- **Not verified**: everything not run or tried by hand, with the reason (no k6/Docker is one); "nothing" only when everything was.
- **Not in this pull request**: limits and follow-ups with issue numbers.

Run missing checks before opening with `verify-change` (it lists what ran) unless told not to; workflow changes also need `zizmor .github`.

When the request path changed, also compare with the base as CI does (`tools/README.md`, "Comparison with the base"; needs k6 and a built `master` worktree):
```sh
git worktree add ../base master && (cd ../base && pnpm install --frozen-lockfile && pnpm build)
SERVER_PREFIX='taskset -c 0-2' K6_PREFIX='taskset -c 3' node tools/dist/scripts/compare-with-base.js ../base . 3 15s 10s
```
`SERVER_ENV=ACCESS_LOGS=1 MAIN_ONLY=1` repeats it with access logs on. Report the result under Verification, or under Not verified if it did not run.

## Opening
1. Title = squash commit: imperative sentence, no prefix, no number.
2. `git push -u origin HEAD`; never push to `master`.
3. `gh pr create --base <base> --title ... --body-file <file>` with the body in the scratchpad directory; end it with the attribution line from the conversation, if any.
4. Do not merge or change repository settings.
5. Give the user the link and the Not verified list.

Never comment on the PR; when the change moves, update it with `gh pr edit --body-file`, keeping the template.
