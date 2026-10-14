---
mode: agent
description: Investigate an issue, implement the fix, validate it, and summarize the result with repo-specific checks.
---

Fix the issue in the current branch using the repo’s project rules and workflow.

## 1. Understand the issue
- Read the issue or task description, the linked requirements, and the code paths it affects.
- Identify the exact behavior that is wrong, the expected behavior, and the smallest code path that reproduces it.
- If the issue is ambiguous, record the ambiguities before changing code.

## 2. Plan the fix
- Keep the change narrow and focused on the root cause.
- Check whether the issue affects request handling, workers, lambda execution, proxying, logging, or package boundaries.
- Read the relevant README section before modifying request-path behavior or server architecture.
- Prefer existing utilities and patterns over adding new abstractions.

## 3. Implement
- Update the relevant code and tests together.
- Follow repo conventions: strict TypeScript, no `any`, prefer `undefined` over `null`, flat conditions, one function per file in utility modules when applicable.
- Do not reformat unrelated code; keep edits minimal and readable.
- Add a regression test that fails without the fix.

## 4. Validate
Run the required checks for the touched area:
- `pnpm lint`
- `pnpm build`
- `pnpm quality`
- `pnpm test:integration` when behavior or integration paths changed
- `pnpm load-test` when request path, worker, logging, or proxying changed

If a tool is not available locally, say so under **Not verified** and do not claim the change is fully validated.

## 5. Report
Provide a concise final summary with:
- what changed
- why it was needed
- which tests/checks ran and passed
- which checks did not run and why
- any remaining caveat or follow-up

Be explicit about uncertainty and evidence from the command output before saying the fix is complete.
