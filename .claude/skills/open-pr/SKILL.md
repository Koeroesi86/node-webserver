---
name: open-pr
description: Open a pull request for the current branch with the repository template filled in, the packages that publish worked out, and only the checks that were run ticked. Trigger "open pr", "create pr", "/open-pr".
allowed-tools: Read, Bash
---

Open a pull request for the current branch. `CLAUDE.md` has the rules, this is the order to apply them in.

## Before anything is pushed

1. Refuse on `master`. The branch must come off `master` and hold one change. If it holds more, say so and stop.
2. Find what changed: `git diff --name-only origin/master...HEAD`.
3. A pull request stacked on another branch has that branch as its base (`--base`), and "What and why" says so.

## Which packages publish

A change in `packages/<name>/**` or `pnpm-lock.yaml` publishes that package and every package that depends on it:

| Changed | Publishes |
|---|---|
| `node-worker` | `node-worker`, `node-worker-express`, `node-webserver`, `node-webserver-cli`, `node-webserver-service` |
| `node-worker-express`, `node-lambda-invoke` | itself, `node-webserver`, `node-webserver-cli`, `node-webserver-service` |
| `node-webserver` | itself, `node-webserver-cli`, `node-webserver-service` |
| `node-webserver-cli`, `node-webserver-service` | itself |
| `pnpm-lock.yaml` | every package whose dependencies changed in it, plus the ones that depend on them |

Check the table against the `workspace:*` dependencies in the `package.json` files, as it goes stale when they change. Then say whether the change is breaking for the users of the package. A change only in `tools/`, docs or `.github/` publishes nothing, and the Release section is deleted.

## The body

Fill in `.github/pull_request_template.md`, section by section, no free-form summary:

- **What and why**: the reason, in a few sentences. `Closes #N` for the issue, or the pull request it is stacked on.
- **Changes**: one line for each.
- **Behaviour changes**: config, API, defaults or output the users notice. Delete the section if there are none.
- **Release**: the packages from above and whether it is breaking.
- **Verification**: tick only what was run in this session, and read the output before ticking. `pnpm lint`, `pnpm build`, `pnpm test` and `pnpm test:integration` are one box, so tick it only when all four passed. The load test is required when the request path, workers, logging or proxying changed, and CI counts for it only once it has run.
- **Not verified**: everything that was not run or not tried by hand, with the reason (no k6 or Docker on the machine is a reason). Write "nothing" only when everything was.
- **Not in this pull request**: known limits and follow-ups with issue numbers.

Run the checks that are missing before opening, unless the user said not to. A workflow change also needs `zizmor .github`.

## Opening it

1. The title is the squash commit: an imperative sentence without a prefix ("Add ...", "Cancel a request that ..."), without the number.
2. Push the branch with `git push -u origin HEAD`. Never push to `master`.
3. `gh pr create --base <base> --title ... --body-file <file>`, with the body written to a file in the scratchpad directory. End the body with the attribution line from the conversation, when there is one.
4. Do not merge, and do not change the settings of the repository.
5. Give the user the link and the list of what was not verified.

When the change moves after the pull request is open, update the description with `gh pr edit --body-file` so it stays true.
