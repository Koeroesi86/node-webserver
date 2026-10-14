---
mode: agent
description: Run the repo verification checks for a change
---

Review the change and run the smallest valid verification set for the code touched.

Default checks for a package change:
- `pnpm lint`
- `pnpm build`
- `pnpm quality`

Also run:
- `pnpm test:integration` for server behavior or integration-level changes
- `pnpm load-test` when the request path, workers, logging or proxying changed

Report:
- which checks ran successfully
- which checks were skipped and why
- any issues found, with the exact command output summary
- whether the fix is verified or only partially verified

Do not say “done” without fresh verification output.
