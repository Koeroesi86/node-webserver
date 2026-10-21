# node-webserver

pnpm workspace: a web server hosting workers, lambdas and proxied apps by virtual host, plus its libraries, published to npm as `@koeroesi86/*`.
`README.md` has the design and packages (read the design section before changing the request path), `tools/README.md` the versions and load tests. The READMEs are long (`packages/node-webserver/README.md` ~5900 words, `tools/README.md` ~4800): grep for the heading and read that section, not the whole file.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build              # every package in dependency order; scripts and tests of other packages run the compiled dist
pnpm lint               # eslint with prettier (flat config in `eslint.config.js`)
pnpm fallow             # unused files/exports/dependencies, duplication, complexity (`.fallowrc.jsonc`)
pnpm quality            # fallow with test coverage for exact CRAP scores, as the pipeline runs it (`.fallowrc.ci.jsonc`)
pnpm test               # unit tests
pnpm test:coverage      # coverage: html per package in `packages/*/coverage/lcov-report`, merged `coverage/report.md` and `report.json` in the root; `pnpm coverage:merge` writes `coverage/coverage-final.json` for `pnpm quality`
pnpm test:integration   # starts the built server with one server of every type
pnpm docs:build         # the site of `docs/` (VitePress) in `docs/.vitepress/dist`; `pnpm docs:dev` serves it, a dead link fails the build
pnpm load-test          # k6 against the example server, needs k6 or Docker
```

Before saying something is done, run `pnpm lint`, `pnpm build`, `pnpm quality` (runs the unit tests with coverage), `pnpm test:integration`, plus the load test when the request path, workers, logging or proxying changed. Say which you did not run.

## Layout

| Folder | What it is |
|---|---|
| `packages/node-webserver` | front server: `src/server/start-server.ts` builds two express apps (http, https with SNI) from the configuration, `src/middlewares/` has the `lambda` and `proxy` middlewares (the static worker is the one of `node-worker-express`), access logs and compression, `src/scripts/` the entries (`server.ts`, `load-test-server.ts`), `examples/` one per server type, `integration/` the integration test |
| `packages/node-webserver-cli`, `node-webserver-service` | thin wrappers: command line runner and systemd or launchd service generator |
| `packages/node-lambda-invoke` | runs AWS Lambda style handlers locally, each lambda a worker of the pool of `node-worker` (`@koeroesi86/node-worker/pool`) that answers one request at a time |
| `packages/node-worker`, `node-worker-express` | WebWorker-like API for Node with the pool of worker processes on it in `src/pool/` (published as `@koeroesi86/node-worker/pool`: leases, framed channel, protocol, the side of the worker process) which the lambdas and the workers both run on, and the express middleware on the pool |
| `tools/` | `@koeroesi86/tools`, never published: versioning for the pipeline and the k6 load tests (`tools/README.md`) |
| `docs/` | short pages on goals, architecture and behaviour, published to GitHub Pages by `docs.yml` (VitePress, config in `docs/.vitepress/config.mts`); links to files outside `docs/` are GitHub URLs, as VitePress cannot resolve them |
| `.github/` | workflows (`pr-checks.yml` gates master), PR template, dependabot and zizmor config |

- `node-worker` and `node-worker-express` build with rollup, the rest with `tsc -p tsconfig.build.json`, all to `dist/`. Packages depend on each other via `workspace:*`, so run `pnpm build` after changing a dependency.
- `pnpm fallow` enforces complexity per function (cyclomatic 20, cognitive 15, CRAP 30, errors in the pipeline), duplication and which package may import which (`boundaries` in `.fallowrc.jsonc`): a new `workspace:*` dependency goes into those rules.
- Eslint enforces no casts, no `null` literal (comparisons are fine), no non-null assertions and flat code (`max-depth`) in `eslint.config.js`; where a Node API or the wire protocol needs `null`, `// eslint-disable-next-line` says why. Tests and mocks are exempt from the casts and `null`. `.claude/hooks/standards-gate.sh` blocks the prettier write flag, `gh pr comment`, `--no-verify`, a push to `master` and, before a commit or push, added files that are not kebab-case, are not exported by the `index.ts` of their folder, or whose `utils/` file exports more than one thing or has no test (it matches the command text, so a commit message that quotes a blocked command is blocked too); `eslint-fix.sh` runs `eslint --fix` on every `.ts` file Claude writes.
- `.claude/hooks/fallow-gate.sh` (from `fallow hooks install --target agent`) runs `fallow audit` before Claude's `git commit`/`git push` and blocks on a finding the change introduces. It needs `jq` and `node` on the PATH, otherwise it skips silently.
- Jest with ts-jest, `src/**/*.test.ts`. `jest-retry.js` retries a failing test twice (process and socket tests depend on the runner), so a test that only passes on a retry is flaky: fix it. The integration test has its own config (`packages/node-webserver/integration/jest.config.js`).
- `node >=24`, pnpm 12 (`corepack enable`). Eslint v8 with prettier 2, run from the root only.

## Local pitfalls

- `node` and `pnpm` can be missing from a non-interactive shell's PATH (nvm and pnpm home are set in the profile). Prefix: `export PATH=$HOME/.nvm/versions/node/<node 24>/bin:$HOME/.local/share/pnpm/bin:$PATH`.
- Never run `prettier --write` (it ignores the 160 columns and reformats whole files). Use `pnpm exec eslint --fix <paths>` and read `git diff` for hunks in code you did not change.
- k6, Docker and podman are not installed on the author's machine, so the load test cannot run there: say so under **Not verified**.

## Pull requests

- **Tickets are GitHub issues** (`gh issue list`, `gh issue view <N>`). Read the issue and comments first; link with `Closes #N`.
- **Use `.github/pull_request_template.md`, every section filled.** Delete a section only where the template says (Behaviour changes, Release).
- Verification: do not list what CI runs (lint, build, tests, quality, integration, load test); write what you tried by hand. Put what neither CI nor you covered under **Not verified**; "nothing" only when everything was covered.
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
- **Folders are imported through their `index.ts`**: `utils/`, `middlewares/`, `classes/` and `server/` have a barrel that exports every file in it, and code outside the folder imports `../utils`, never `../utils/name` (eslint `no-restricted-imports`; the files of a folder import each other directly, `./name`, and test helpers are exempt). A new file goes into its `index.ts` (the commit hook checks it). Two folders that import each other make a cycle through their barrels (fallow fails on it): the code that wires folders together lives in its own, like `server/` of node-webserver.
- **A package has one primary entry**, `.` in its `exports` map (`dist/index.js`), and nothing else but `package.json` and what `EXTRA_ENTRIES` in `tools/src/constants/package-entries.ts` lists (`./pool` of node-worker, the schema of node-webserver), so a file of `dist` can move or be renamed without a breaking change; a unit test of `tools` fails on any other entry. Import a package by its name, never `@koeroesi86/x/dist/...`. A new entry goes into `EXTRA_ENTRIES` and is a decision, not a convenience.
- Kebab-case `.ts` files everywhere (a test of `tools` fails on any other), one function per file in `utils/` (named after it), types in `types/`, constants in `constants/`. Scripts only read arguments and the environment and call the utils.
- Keep READMEs and doc comments true: a changed option, default, header, message type or limit is updated in the same change (package `README.md`, root `README.md`, `tools/README.md`), and so is the PR description.
- A test sits next to its code, one test file per unit (`name.test.ts`). A change comes with a test that fails without it. Tests must not depend on machine speed (no fixed sleeps, wait for the event).
- Prefer native Node APIs to packages (`fetch`, `node:*`, `crypto.randomInt`). `fetch` does not throw on non-2xx: check `response.ok` and throw.
- Keep conditions and loops flat (early returns, `filter().map()`); no variable used once unless its name explains something.
- Comments say why, not what, in lower case sentences like the ones around them. No commented-out code.
- The front process is a single, cheap proxy (design in `README.md`). Do nothing per request there that can be done behind it, and measure with the load test when you touch that path. Do not propose several front servers, and do not serve files from it: that is the static worker's job. Rank performance work by what was measured, not guessed.
- After a refactor or dependency swap, check changed files for lost behaviour before calling it done.

## Context

- Filter output before it reaches the context: `tail`/`grep` test, build and CI logs (`gh run view <run> --job <job> --log-failed | tail -150`), read the failing part of a diff, not all of it. Hand wide searches to a subagent and ask for the answer.
- The goal is for every load test (also the Windows and macOS comparison with the base, informational today because of runner noise) to block on failure: do not propose dropping, demoting or deferring them to speed up CI; stabilise the noisy runs instead.
- When CI fails, read the log (`gh pr checks`, `gh run view <run> --job <job> --log-failed`) and fix the cause, with the `check-ci` skill.

Rules that only matter for some files load on demand from `.claude/rules/`: `versions-and-publishing.md` (`packages/**`, publishing) and `workflows.md` (`.github/**`). Read them before such a change if they did not load.
