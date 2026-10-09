---
name: verify-change
description: Run the checks the repository requires before a change counts as done (lint, build, unit and integration tests, the load test when the request path changed) and report which ran and which did not. Trigger "verify", "verify change", "/verify-change".
allowed-tools: Read, Bash
---

Run the checks that `CLAUDE.md` requires before something is called done, and finish with an honest list of what ran. The list is what the Verification and **Not verified** sections of the pull request are written from (see `open-pr`).

## Setup

`node` and `pnpm` can be missing from the PATH of the shell. When `pnpm` is not found, prefix every command with `export PATH=$HOME/.nvm/versions/node/<node 24>/bin:$HOME/.local/share/pnpm/bin:$PATH` (the version folder is in `~/.nvm/versions/node/`).

## Which checks

Find what changed with `git diff --name-only origin/master...HEAD` and `git status --short`.

Run these in order, from the root, and stop to fix a failure before going on, as the later steps run the `dist` of the earlier ones:

1. `pnpm lint`
2. `pnpm build`
3. `pnpm test`
4. `pnpm test:integration`

The load test (`pnpm load-test`) is required when the request path, workers, logging or proxying changed. That is `packages/node-webserver/src/**`, `packages/node-worker/**`, `packages/node-worker-express/**` and `packages/node-lambda-invoke/**`, except for tests and docs. It needs k6 or Docker, so check `command -v k6 docker podman` first, and when none is there do not skip it silently: it is **Not verified** here, and CI runs it on the pull request.

A change to a workflow also needs `zizmor .github` (offline works).

## When something fails

- Read the output and find the cause. Do not skip a check, add `continue-on-error`, or use `--no-verify` to get past it.
- A test that passes only on a retry is flaky (`jest-retry.js` hides it), so look at the log of the retries before calling it passed, and fix the test, which must not depend on the speed of the machine.
- Fix lint with `pnpm exec eslint --fix --ext .ts <paths>`, never with `prettier --write`, and read `git diff` afterwards for hunks in code that was not changed.

## The report

End with one list, nothing rounded up:

- **Ran and passed**: the commands, as they were run.
- **Ran and failed**: the command and the failure, if any is left.
- **Not run**: the command and the reason (for example, no k6 or Docker on the machine).

Also look at the changed files once for behaviour that a refactor or a dependency swap lost, as CLAUDE.md asks, and say that you did.
