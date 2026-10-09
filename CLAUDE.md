# node-webserver

A pnpm workspace: a web server that hosts workers, lambdas and proxied apps by virtual host, and the libraries around it, all published to npm as `@koeroesi86/*`.
`README.md` has the design and the packages, `tools/README.md` the versions and the load tests. Read the design section before changing the request path.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build              # every package, in dependency order; the scripts and the tests of other packages run the compiled dist
pnpm lint               # eslint with prettier, `--ext .ts`
pnpm test               # unit tests
pnpm test:integration   # starts the built server with one server of every type
pnpm load-test          # k6 against the example server, needs k6 or Docker
```

Before saying something is done, run `pnpm lint`, `pnpm build`, `pnpm test` and `pnpm test:integration`, plus the load test when the request path, workers, logging or proxying changed. Say which of them you did not run.

## Pull requests

- **Use `.github/pull_request_template.md` and fill in every section.** Delete a section only where the template says so (Behaviour changes, Release). The body is not a free-form summary.
- Verification: tick only what was run. Put what was not run, or not tried by hand, under **Not verified**, and write "nothing" only when everything was.
- Release: say which packages publish (a change in `packages/**` or `pnpm-lock.yaml`, or in a package they depend on) and whether it is breaking. Delete the section for tools, docs and CI only.
- A pull request stacked on another one says so in "What and why" and has that branch as its base.
- One change per pull request, from a branch off `master`. Never push to `master`. Do not merge, or change the settings of the repository, unless asked.
- The title is the squash commit: a sentence in the imperative without a prefix ("Add ...", "Cancel a request that ..."), the number is added by GitHub. The body of a commit says why.
- After the pull request is open, keep its description true when the change moves.

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
