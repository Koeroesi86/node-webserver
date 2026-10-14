---
mode: agent
description: Diagnose CI failures or success for the current branch or a GitHub Actions run link.
---

Diagnose CI for the current branch or the given GitHub Actions run link.

## 1. Find the run
Use the provided link if available. Otherwise:
- `gh pr checks`
- `gh run list --branch "$(git branch --show-current)" --limit 5`

Identify the commit SHA and the failing jobs.

## 2. Read the failure
For each failed job:
- gather the failing job id
- read the failing log with `gh run view <run> --job <id> --log-failed | tail -150`
- identify the first real error, not the cascade failure

Also check whether the job never started, which often indicates invalid workflow YAML or a failed `needs` chain.

## 3. Classify the failure
Determine whether it is:
- lint/build/fallow
- unit or integration test
- load test / k6 scenario
- workflow or security issue

Compare against the branch baseline or `master` when relevant; do not blame the change without reproducing or checking the runner context.

## 4. Report
Give:
- failing job and step name
- the main error message/stack trace
- whether the cause appears to be the code change or the runner environment
- the fix or required follow-up
- any check that could not be reproduced locally because required tools were missing

Do not suggest bypassing checks, skipping them with `continue-on-error`, or removing a required validation. If a failure is flaky, call out the retry behavior and the requirement to fix the root cause rather than masking it.
