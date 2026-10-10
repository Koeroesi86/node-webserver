# node-webserver

A pnpm workspace: a web server that hosts workers, lambdas and proxied apps by virtual host, and the libraries around it, all published to npm as `@koeroesi86/*`.
`README.md` has the design and the packages, `tools/README.md` the versions and the load tests. Read the design section before changing the request path.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build              # every package, in dependency order; the scripts and the tests of other packages run the compiled dist
pnpm lint               # eslint with prettier, `--ext .ts`
pnpm fallow             # unused files, exports and dependencies (errors), duplication and complexity, configured in `.fallowrc.jsonc`
pnpm test               # unit tests
pnpm test:integration   # starts the built server with one server of every type
pnpm load-test          # k6 against the example server, needs k6 or Docker
```

Before saying something is done, run `pnpm lint`, `pnpm fallow`, `pnpm build`, `pnpm test` and `pnpm test:integration`, plus the load test when the request path, workers, logging or proxying changed. Say which of them you did not run.

## Layout

| Folder | What it is |
|---|---|
| `packages/node-webserver` | the front server: `src/utils/startServer.ts` builds two express apps (http, https with SNI) from the configuration, `src/middlewares/` has one middleware per server type (`staticWorker`, `lambda`, `proxy`) plus access logs and compression, `src/scripts/` the entries (`server.ts`, `load-test-server.ts`), `examples/` one example per server type, `integration/` the integration test |
| `packages/node-webserver-cli`, `node-webserver-service` | thin wrappers around `node-webserver`: a command line runner and an OS service (`os-service`) |
| `packages/node-lambda-invoke` | runs AWS Lambda style handlers locally, each in its own process |
| `packages/node-worker`, `node-worker-express` | WebWorker-like API for Node and the express middleware that uses it, which is what the worker pools of the server are built on |
| `tools/` | `@koeroesi86/tools`, never published: versioning for the pipeline and the k6 load tests, layout in `tools/README.md` |
| `.github/` | workflows (`pr-checks.yml` gates master), the pull request template, dependabot and zizmor config |

- `node-worker` and `node-worker-express` build with rollup, all the others with `tsc -p tsconfig.build.json`; every package builds to `dist/`. Packages depend on each other through `workspace:*`, so a package is tested against the `dist` of the ones it uses: run `pnpm build` after changing a dependency.
- Jest with ts-jest, `src/**/*.test.ts`. `jest-retry.js` in the root retries a failing test twice because process and socket tests depend on the runner, so a test that only passes on a retry is still a flaky test: fix it. The integration test has its own config (`packages/node-webserver/integration/jest.config.js`).
- The older packages use camelCase file names (`startServer.ts`, `setupVirtualHosts.ts`); new files follow the kebab-case rule above, and do not rename the existing ones without a reason, as that touches `packages/**` and publishes it.
- `node >=24` and pnpm 12 (`corepack enable`). Eslint is v8 with prettier 2, run from the root only.

## Local pitfalls

- `node` and `pnpm` can be missing from the PATH of a non-interactive shell (nvm and the pnpm home are set up in the profile only). Prefix the command with `export PATH=$HOME/.nvm/versions/node/<node 24>/bin:$HOME/.local/share/pnpm/bin:$PATH`.
- Never run `prettier --write` directly: it ignores the 160 columns of the eslint setup and reformats whole files. Use `pnpm exec eslint --fix --ext .ts <paths>` and read `git diff` for hunks in code you did not change.
- k6, Docker and podman are not installed on the machine this was written on, so the load test cannot run there. Say so under **Not verified** instead of leaving it out.

## Pull requests

- **Tickets are GitHub issues** (`gh issue list`, `gh issue view <N>`). Read the issue and its comments before starting, and link it with `Closes #N` in the pull request.
- **Use `.github/pull_request_template.md` and fill in every section.** Delete a section only where the template says so (Behaviour changes, Release). The body is not a free-form summary.
- Verification: tick only what was run. Put what was not run, or not tried by hand, under **Not verified**, and write "nothing" only when everything was.
- Release: say which packages publish (a change in `packages/**` or `pnpm-lock.yaml`, or in a package they depend on) and whether it is breaking. Delete the section for tools, docs and CI only.
- A pull request stacked on another one says so in "What and why" and has that branch as its base.
- One change per pull request, from a branch off `master`. Never push to `master`. Do not merge, or change the settings of the repository, unless asked.
- The title is the squash commit: a sentence in the imperative without a prefix ("Add ...", "Cancel a request that ..."), the number is added by GitHub. The body of a commit says why.
- **Do not comment on pull requests** (`gh pr comment`, reviews, replies). Put what a reader needs into the description (`gh pr edit --body-file`), following the template, and keep it true when the change moves. Commits to the branch are fine.

## Code

- TypeScript with strict null checks. No `any` (lint fails on it) and no casts to get past the compiler; prefer `undefined` over `null`.
- Prettier through eslint: single quotes, semicolons, 160 columns. Do not reformat code you do not change.
- Files are kebab-case, one function per file in `utils/` (named after it), types and interfaces in `types/`, constants in `constants/`. Scripts only read arguments and the environment, and call the utils.
- A test sits next to the code it tests (`name.test.ts`). A change comes with a test that fails without it. Tests must not depend on the speed of the machine (no sleeping for a fixed time, wait for the event).
- Prefer the native Node API to a package (`fetch`, `node:*`, `crypto.randomInt`). `fetch` does not throw on a non-2xx status: check `response.ok` and throw.
- Keep conditions and loops flat (early returns, `filter().map()` chains) and do not add a variable that is used once, unless its name explains something.
- Comments say why, not what, in lower case sentences like the ones around them. No commented-out code.
- The front process is a single, cheap proxy (see the design in `README.md`). Do nothing per request there that can be done behind it, and measure with the load test when you touch that path. Do not propose several front servers.
- After a refactor or a dependency swap, check the changed files for behaviour that was lost before you call it done.

## Versions and publishing

- Never edit the `version` of a package or `gitHead`. The pipeline stamps them (`tools/src/scripts/version.ts`).
- A change in a package folder publishes a new version of it and of the packages that depend on it, so keep unrelated edits out of `packages/**`.
- `publish.yml` runs twice a day and by hand, builds and packs without the permission for the provenance, and a job that runs no repository code publishes the tarballs. Keep it that way.

## Workflows (`.github/`)

- Pin every action to a full commit SHA with the version as a comment (`uses: owner/action@<sha> # v1.2.3`). Dependabot keeps them updated, and it waits 7 days before it proposes a release.
- `permissions: contents: read` at the top, wider permissions on the job that needs them, with a comment saying why. `persist-credentials: false` on every checkout. Never interpolate `${{ ... }}` of untrusted input into a `run:` script, pass it through `env:`.
- Run `zizmor .github` (offline works) before opening a pull request that touches a workflow. The single check master requires is `required-checks` in `pr-checks.yml`: a new job that must pass goes into its `needs`.
- Do not enable bypass flags or skip checks (`--no-verify`, `continue-on-error`) to make something pass; find out why it fails. `continue-on-error` stays only where a comment explains it (the informational comparisons).
