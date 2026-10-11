---
name: verify-change
description: Run the checks the repository requires before a change counts as done (lint, build, quality with unit tests, integration test, load test when the request path changed), verify the issue with verify-task, and report what ran and what did not. Trigger "verify", "verify change", "/verify-change".
allowed-tools: Read, Bash, Skill
---

Run what `CLAUDE.md` requires before something is called done. The report feeds the Verification and **Not verified** sections of the pull request (`open-pr`).

If `pnpm` is not found, prefix commands with `export PATH=$HOME/.nvm/versions/node/<node 24>/bin:$HOME/.local/share/pnpm/bin:$PATH` (version folder in `~/.nvm/versions/node/`).

## Checks
Changed files: `git diff --name-only origin/master...HEAD` and `git status --short`.

From the root, in order, fixing a failure before going on (later steps run the `dist` of earlier ones):
1. `pnpm lint`
2. `pnpm build`
3. `pnpm quality` (runs the unit tests with coverage, then fallow)
4. `pnpm test:integration`

- Load test (`pnpm load-test`): required when the request path changed (`packages/node-webserver/src/**`, `node-worker/**`, `node-worker-express/**`, `node-lambda-invoke/**`, except tests and docs). Check `command -v k6 docker podman`; with none, it is **Not run** here (CI runs it), never silently skipped.
- Workflow change: also `zizmor .github` (offline works).
- Finally run the `verify-task` skill on the branch's issue and include its gaps. Skip with a note if no issue is found.

## Failures
- Find the cause; never skip a check, add `continue-on-error` or use `--no-verify`.
- A test that passes only on a retry is flaky (`jest-retry.js` hides it): check the retry log, fix the test, no dependence on machine speed.
- Fix lint with `pnpm exec eslint --fix --ext .ts <paths>`, never `prettier --write`; read `git diff` for hunks in code you did not change.

## Report
One list, nothing rounded up:
- **Ran and passed**: commands as run.
- **Ran and failed**: command and failure.
- **Not run**: command and reason (e.g. no k6 or Docker).
- **Task** (`verify-task`): requirements Partial/Missing, or "all covered".

Also read the changed files once for behaviour a refactor or dependency swap lost, and say you did.
