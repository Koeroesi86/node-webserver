# Development

A pnpm workspace on Node 24 and newer (`corepack enable`). [CLAUDE.md](https://github.com/Koeroesi86/node-webserver/blob/master/CLAUDE.md) has the conventions in full, this page is the short version.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build              # every package, in dependency order
pnpm lint               # eslint with prettier
pnpm quality            # unit tests with coverage, then fallow (unused code, duplication, complexity)
pnpm test:integration   # starts the built server with one server of every type
pnpm load-test          # k6 against the example server, needs k6 or Docker
pnpm start              # the server with the example configuration
pnpm docs:dev           # these pages as a site, with reload (pnpm docs:build checks the links)
```

Run the checks above before calling a change done, and the load test when the request path, workers, logging or proxying changed. Do not run `prettier --write`, use `pnpm exec eslint --fix <paths>`.

## Conventions

- TypeScript with strict null checks, no `any`, no casts to get past the compiler, `undefined` over `null`.
- New files are kebab-case, one function per file in `utils/`, types in `types/`, constants in `constants/`.
- A test sits next to its code (`name.test.ts`), and a change comes with a test that fails without it. Tests do not depend on machine speed.
- Prefer native Node APIs to packages. Keep conditions and loops flat.
- A changed option, default, header or limit is updated in the READMEs and these pages in the same change.

## Pull requests and releases

- Tickets are GitHub issues. A PR is one change from a branch off `master`, uses the template, and its title is an imperative sentence.
- The pipeline (`.github/workflows/`) gates `master` with `pr-checks.yml` and publishes twice a day. A package is published when its folder, or the folder of a workspace package it depends on, changed since its latest release.
- Never edit `version` or `gitHead` of a package, the pipeline stamps them ([Versions](https://github.com/Koeroesi86/node-webserver/blob/master/tools/README.md#versions)).

## This site

The pages in `docs/` are built with [VitePress](https://vitepress.dev) (`docs/.vitepress/config.mts`) and published to GitHub Pages by `.github/workflows/docs.yml` when they change on `master`. Pull requests build it, and a link that leads nowhere fails the build.
VitePress only resolves links inside `docs/`, so a link to a README or a file of a package is a full GitHub URL. A new page goes into the sidebar in the config.
