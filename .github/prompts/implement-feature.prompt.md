---
mode: agent
description: Implement the requested feature end-to-end, validate it, and document any release or verification caveats.
---

Implement the requested feature end-to-end in this repository while preserving the project’s architecture and quality constraints.

## 1. Understand the feature
- Read the issue, requirement, or description carefully.
- Check how the existing architecture handles similar functionality in the relevant package.
- Identify whether the change touches request handling, existing workers, lambdas, proxy behavior, configuration, or package publishing.

## 2. Design and implement
- Keep the change aligned with the current server architecture.
- Prefer the smallest change that satisfies the requirement.
- Add or update tests to cover the new behavior and the failure/refusal path when relevant.
- Keep docs, README sections, and type comments in sync when behavior, defaults, headers, or options change.
- Respect package and dependency boundaries; do not broaden scope or add unrelated refactors.

## 3. Validate
Run the relevant verification commands from the repo root:
- `pnpm lint`
- `pnpm build`
- `pnpm quality`
- `pnpm test:integration` for server or integration changes
- `pnpm load-test` when request path, worker, logging, or proxy behavior changed

If a check cannot run, record the reason under **Not verified** instead of silently skipping it.

## 4. Final result
Report:
- the implemented behavior
- files changed and why
- whether the feature is release-impacting
- which checks passed
- which checks did not run and why
- any follow-up or remaining risk

Do not mark the feature as complete without fresh evidence from the relevant verification output.
