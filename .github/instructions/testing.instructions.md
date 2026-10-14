---
applyTo: "**/*.{test.ts,ts,js}"
---

# Testing instructions

- Add or update a focused test with the code change.
- Keep tests next to the code they cover, using the repo’s Jest structure.
- Prefer the real behavior under test rather than mock-heavy assertions.
- A retry-only pass is a flaky test: fix the root cause instead of accepting the retry.
- Never use fixed sleeps to force timing; wait for the event or condition under test.
- New tests should fail without the code change that fixes them.
- When a change affects server behavior, run the relevant integration checks as well.
- For worker or proxy path changes, test the real request flow instead of isolated unit assertions only.
