# node-webserver

pnpm workspace: a web server hosting workers, lambdas and proxied apps by virtual host, plus its libraries, published to npm as `@koeroesi86/*`.
`README.md` has the design and packages (read the design section before changing the request path), `tools/README.md` the versions and load tests.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build              # every package in dependency order; scripts and tests of other packages run the compiled dist
pnpm lint               # eslint with prettier, `--ext .ts`
pnpm fallow             # unused files/exports/dependencies, duplication, complexity (`.fallowrc.jsonc`)
pnpm quality            # fallow with test coverage for exact CRAP scores, as the pipeline runs it (`.fallowrc.ci.jsonc`)
pnpm test               # unit tests
pnpm test:coverage      # coverage: html per package in `packages/*/coverage/lcov-report`, merged `coverage/report.md` and `report.json` in the root; `pnpm coverage:merge` writes `coverage/coverage-final.json` for `pnpm quality`
pnpm test:integration   # starts the built server with one server of every type
pnpm load-test          # k6 against the example server, needs k6 or Docker
```

Before saying something is done, run `pnpm lint`, `pnpm build`, `pnpm quality` (runs the unit tests with coverage), `pnpm test:integration`, plus the load test when the request path, workers, logging or proxying changed. Say which you did not run.

## Layout

| Folder | What it is |
|---|---|
| `packages/node-webserver` | front server: `src/utils/startServer.ts` builds two express apps (http, https with SNI) from the configuration, `src/middlewares/` has the `lambda` and `proxy` middlewares (the static worker is the one of `node-worker-express`), access logs and compression, `src/scripts/` the entries (`server.ts`, `load-test-server.ts`), `examples/` one per server type, `integration/` the integration test |
| `packages/node-webserver-cli`, `node-webserver-service` | thin wrappers: command line runner and OS service (`os-service`) |
| `packages/node-lambda-invoke` | runs AWS Lambda style handlers locally, each in its own process |
| `packages/node-worker`, `node-worker-express` | WebWorker-like API for Node and the express middleware on it, which the worker pools are built on |
| `tools/` | `@koeroesi86/tools`, never published: versioning for the pipeline and the k6 load tests (`tools/README.md`) |
| `.github/` | workflows (`pr-checks.yml` gates master), PR template, dependabot and zizmor config |

- `node-worker` and `node-worker-express` build with rollup, the rest with `tsc -p tsconfig.build.json`, all to `dist/`. Packages depend on each other via `workspace:*`, so run `pnpm build` after changing a dependency.
- `pnpm fallow` enforces complexity per function (cyclomatic 20, cognitive 15, CRAP 30, errors in the pipeline), duplication and which package may import which (`boundaries` in `.fallowrc.jsonc`): a new `workspace:*` dependency goes into those rules.
- `.claude/hooks/fallow-gate.sh` (from `fallow hooks install --target agent`) runs `fallow audit` before Claude's `git commit`/`git push` and blocks on a finding the change introduces. It needs `jq` and `node` on the PATH, otherwise it skips silently.
- Jest with ts-jest, `src/**/*.test.ts`. `jest-retry.js` retries a failing test twice (process and socket tests depend on the runner), so a test that only passes on a retry is flaky: fix it. The integration test has its own config (`packages/node-webserver/integration/jest.config.js`).
- Older packages use camelCase file names (`startServer.ts`); new files are kebab-case. Do not rename old ones without a reason: it touches `packages/**` and publishes.
- `node >=24`, pnpm 12 (`corepack enable`). Eslint v8 with prettier 2, run from the root only.

## Local pitfalls

- `node` and `pnpm` can be missing from a non-interactive shell's PATH (nvm and pnpm home are set in the profile). Prefix: `export PATH=$HOME/.nvm/versions/node/<node 24>/bin:$HOME/.local/share/pnpm/bin:$PATH`.
- Never run `prettier --write` (it ignores the 160 columns and reformats whole files). Use `pnpm exec eslint --fix --ext .ts <paths>` and read `git diff` for hunks in code you did not change.
- k6, Docker and podman are not installed on the author's machine, so the load test cannot run there: say so under **Not verified**.

## Pull requests

- **Tickets are GitHub issues** (`gh issue list`, `gh issue view <N>`). Read the issue and comments first; link with `Closes #N`.
- **Use `.github/pull_request_template.md`, every section filled.** Delete a section only where the template says (Behaviour changes, Release).
- Verification: tick only what was run. Put what was not run or tried by hand under **Not verified**; "nothing" only when everything was.
- Release: say which packages publish (a change in `packages/**` or `pnpm-lock.yaml`, or in a package they depend on) and whether it is breaking. Delete for tools, docs and CI only.
- A PR stacked on another says so in "What and why" and has that branch as its base.
- One change per PR, from a branch off `master`. Never push to `master`. Do not merge or change repository settings unless asked.
- Title = squash commit: imperative sentence, no prefix ("Add ...", "Cancel a request that ..."); GitHub adds the number. The commit body says why.
- **Follow-ups are issues, not scope.** Tech debt, flaky tests, "later" ideas and the request-side mirror of a change each get their own GitHub issue, linked under "Not in this pull request". An issue has Problem / Idea / what is lost or at risk / Open points / Alternatives considered (see #137), and a hypothesis says it still has to be measured.
- **Branch history stays meaningful.** Squash debug, calibration and retry commits into meaningful ones before the PR is reviewed. The user rebases and force-pushes too: `git fetch` and compare with `origin/<branch>` before editing or pushing, and reset to the remote first when it moved.
- **Do not comment on PRs** (`gh pr comment`, reviews, replies). Put what a reader needs in the description (`gh pr edit --body-file`), following the template, and keep it true when the change moves. Commits to the branch are fine.

## Code

- TypeScript, strict null checks. No `any` (lint fails) and no casts to get past the compiler; prefer `undefined` over `null`.
- Prettier via eslint: single quotes, semicolons, 160 columns. Do not reformat code you do not change.
- Kebab-case files, one function per file in `utils/` (named after it), types in `types/`, constants in `constants/`. Scripts only read arguments and the environment and call the utils.
- Keep READMEs and doc comments true: a changed option, default, header, message type or limit is updated in the same change (package `README.md`, root `README.md`, `tools/README.md`), and so is the PR description.
- A test sits next to its code, one test file per unit (`name.test.ts`). A change comes with a test that fails without it. Tests must not depend on machine speed (no fixed sleeps, wait for the event).
- Prefer native Node APIs to packages (`fetch`, `node:*`, `crypto.randomInt`). `fetch` does not throw on non-2xx: check `response.ok` and throw.
- Keep conditions and loops flat (early returns, `filter().map()`); no variable used once unless its name explains something.
- Comments say why, not what, in lower case sentences like the ones around them. No commented-out code.
- The front process is a single, cheap proxy (design in `README.md`). Do nothing per request there that can be done behind it, and measure with the load test when you touch that path. Do not propose several front servers, and do not serve files from it: that is the static worker's job. Rank performance work by what was measured, not guessed.
- After a refactor or dependency swap, check changed files for lost behaviour before calling it done.

## Versions and publishing

- Never edit a package's `version` or `gitHead`; the pipeline stamps them (`tools/src/scripts/version.ts`).
- A change in a package folder publishes it and its dependents: keep unrelated edits out of `packages/**`.
- `publish.yml` runs twice a day and by hand, builds and packs without the provenance permission, and a job that runs no repository code publishes the tarballs. Keep it that way.

## Workflows (`.github/`)

- Pin every action to a full commit SHA with the version as a comment (`uses: owner/action@<sha> # v1.2.3`). Dependabot updates them after a 7 day wait.
- `permissions: contents: read` at the top, wider on the job that needs it with a comment why. `persist-credentials: false` on every checkout. Never interpolate `${{ ... }}` of untrusted input into `run:`; pass it through `env:`.
- Run `zizmor .github` (offline works) before a PR that touches a workflow. The only check master requires is `required-checks` in `pr-checks.yml`: a new must-pass job goes into its `needs`.
- The goal is for every load test (also the Windows and macOS comparison with the base, informational today because of runner noise) to block on failure: do not propose dropping, demoting or deferring them to speed up CI; stabilise the noisy runs instead.
- When CI fails, read the log (`gh pr checks`, `gh run view <run> --job <job> --log-failed`) and fix the cause, with the `check-ci` skill.
- No bypass flags or skipped checks (`--no-verify`, `continue-on-error`) to make something pass; find out why it fails. `continue-on-error` stays only where a comment explains it (informational comparisons).
