---
mode: agent
description: Open a pull request for the current branch using the repo template and package release rules.
---

Open a pull request for the current branch, following the repo rules in `CLAUDE.md` and the template in `.github/pull_request_template.md`.

## Before opening
- Refuse if the branch is based on `master` or if it contains multiple unrelated changes. The branch should be one change from a branch off `master`.
- Check the diff against `origin/master` and identify the impacted files.
- If this PR is stacked on another branch, say so in "What and why" and use the base branch accordingly.

## Which packages publish
A change in `packages/<name>/**` or `pnpm-lock.yaml` publishes that package and its dependents.

- `node-worker` publishes `node-worker`, `node-worker-express`, `node-lambda-invoke`, `node-webserver`, `node-webserver-cli`, `node-webserver-service`
- `node-worker-express` and `node-lambda-invoke` publish themselves, `node-webserver`, `node-webserver-cli`, `node-webserver-service`
- `node-webserver` publishes itself, `node-webserver-cli`, `node-webserver-service`
- `node-webserver-cli` and `node-webserver-service` publish themselves
- `pnpm-lock.yaml` publishes the packages whose dependencies changed, plus their dependents
- `tools/`, docs, and `.github/` do not publish

Check the workspace dependency graph and say whether the change is breaking. If no publishable package is affected, remove the Release section from the PR body.

## PR body
Fill the template section by section:
- **What and why**: a few sentences, including `Closes #N` if an issue is being closed or the stacked base branch if relevant
- **Changes**: one line per change
- **Behaviour changes**: user-visible config, API, default, or output changes; delete if none
- **Release**: affected packages and whether the change is breaking
- **Verification**: what was tried by hand, as run and seen; do not list lint, build, tests, quality, the integration test or the load test, as CI runs them
- **Not verified**: what CI does not cover and was not tried by hand, with a reason
- **Not in this pull request**: follow-ups and scope boundaries with issue links

Run the relevant local verification before opening the PR; CI repeats it, so it is not reported in the PR body.

## Opening
- Title should be an imperative sentence without a prefix, as a squash-commit title.
- Push the branch to origin and open the PR with the filled template.
- Do not merge branch protection settings or repository settings.
- Give the user the PR link and the final **Not verified** list.

Never comment on the PR itself; instead, keep the PR description accurate and up to date with `gh pr edit --body-file` if the change changes.
