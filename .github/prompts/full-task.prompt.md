---
mode: agent
description: Handle the whole task end-to-end: understand the issue, implement the fix or feature, verify it, and prepare the PR-ready result.
---

Handle the full task end-to-end for this repository.

## Stage 1: assess the task
- Identify the issue or feature request, its scope, and the exact behavior that must change.
- Check whether the request is ambiguous, missing acceptance criteria, or inconsistent with the current architecture.
- Read the relevant README section and the code paths involved before changing behavior.
- If a GitHub issue or branch reference exists, use it as the source of truth for requirements.

## Stage 2: clarify scope and gaps
- Review the issue for ambiguities, inconsistencies, and missing requirements.
- Call out any missing acceptance criteria, error/refusal paths, or performance checks before implementing.
- Keep the change narrow and avoid unrelated cleanup or refactors.

## Stage 3: implement the fix or feature
- Update the relevant code and tests together.
- Follow project conventions: TypeScript strict mode, no `any`, prefer `undefined` over `null`, flat conditions, keep utility code focused.
- Do not reformat unrelated code.
- Add or update the regression test and the relevant failure path coverage when appropriate.
- Update README or docs if options, defaults, headers, message types, or limits changed.

## Stage 4: validate the change
Run the repo checks relevant to the affected area:
- `pnpm lint`
- `pnpm build`
- `pnpm quality`
- `pnpm test:integration` for server or integration changes
- `pnpm load-test` when the request path, worker, logging, or proxying changed

If a required check cannot run locally, record it under **Not verified** and do not claim full completion.

## Stage 5: release and PR readiness
- Determine whether the change affects publishable packages, the lockfile, or workflow files.
- Describe the affected packages and whether the change is breaking or non-breaking.
- If preparing a PR, fill the project template using the repo rules and tick only checks that actually ran.
- Note any remaining follow-up, unresolved risk, or issue that should stay out of this scope.

## Final report
Provide a concise but complete result covering:
- the root issue or feature requirement
- what changed and why
- any scope or ambiguity identified before implementation
- which checks ran and passed
- which checks were skipped or could not run and why
- release impact and whether the change is ready
- any follow-up risk or remaining caveat

Do not say the task is complete without evidence from the relevant verification output.
