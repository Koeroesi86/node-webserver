# GitHub Copilot project instructions

This repository is the `node-webserver` monorepo: a web server hosting workers, lambdas and proxied apps by virtual host, plus the published libraries under `@koeroesi86/*`.

## Core workflow

- Prefer the smallest relevant fix and keep changes scoped.
- When touching a dependency or any package code, run the workspace build before calling it done.
- Verify before completion: run the repo checks relevant to the change and report exactly what was run and what was not.
- Do not claim success without evidence from the relevant command output.

## Required checks for changes

For a typical code change in packages, run:

- `pnpm lint`
- `pnpm build`
- `pnpm quality` (unit tests + coverage)
- `pnpm test:integration` when the change affects server behavior or integration paths
- `pnpm load-test` when the request path, workers, logging or proxying changed

If a check was not run, say so clearly under “Not verified”.

## Architecture and behavior

- The front process is a single cheap proxy; do not add request-path work there that can be done behind it.
- Do not serve files from the front process; static hosting is the static worker’s job.
- Read the design section in the package README before changing the request path or server flow.
- Do not propose several front servers or broad architectural rewrites for a small fix.
- Use the existing worker/lambda/proxy patterns rather than inventing new request handling code.

## Code style

- TypeScript strict mode; no `any`; prefer `undefined` over `null`.
- Keep conditions and loops flat; use early returns and native chaining where appropriate.
- One function per file in utility modules when practical.
- Use kebab-case for new files; do not rename old files without a strong reason.
- Use single quotes, semicolons and the repo’s existing formatting conventions; do not reformat unrelated code.
- Prefer native Node APIs over third-party packages when equivalent.
- `fetch` does not throw on non-2xx; explicitly check `response.ok` and throw.
- Comments should explain why, not what.

## Testing expectations

- Add or update a focused test with the code change.
- Tests must not depend on machine speed; prefer waiting on events rather than fixed sleeps.
- A test that only passes on retry is flaky; fix the root cause instead of accepting the retry.
- Keep tests next to the code and use the repo’s existing Jest setup.

## Project conventions

- Keep README and doc comments accurate when options, defaults, headers, message types or limits change.
- Do not edit generated or lockfile content unless the change truly requires it.
- Respect the package boundaries and dependency rules.
- Keep PR and issue work narrow and measurement-driven; do not expand scope into unrelated cleanup.

## When working on this repo

- Prefer minimal, production-relevant edits.
- Reuse existing utilities and patterns before introducing new abstractions.
- Validate behavior with the relevant tests and build output, not just a quick code inspection.
- Call out uncertainty explicitly when a requirement is ambiguous or a check could not be run.

## Repo workflow prompts

Use the Copilot prompt files in `.github/prompts` for the project’s repeatable flows:

- `full-task` for the complete issue/feature workflow in one pass
- `fix-issue` for diagnosing and fixing a bug end-to-end
- `implement-feature` for implementing the requested feature from issue to validation
- `open-pr` for PR creation and release checks
- `verify-change` for required validation before calling work complete
- `verify-task` for issue-to-branch gap analysis
- `task-gaps` for clarifying scope before implementation
- `check-ci` for diagnosing GitHub Actions failures

These are the Copilot equivalents of the repo’s Claude skill workflows, without the Claude-specific hook automation.
