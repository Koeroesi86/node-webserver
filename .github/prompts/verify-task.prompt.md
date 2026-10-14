---
mode: agent
description: Compare the branch against the linked GitHub issue and report what is complete, partial, or missing.
---

Review the current branch against the issue it closes and report what is done, partial, or missing, including test coverage.

## 1. Identify the issue
Use the first valid source in this order:
- the command argument, if a URL, `#N`, or issue number was provided
- `gh pr view --json number,body,closingIssuesReferences`
- `git log origin/master..HEAD --format=%B` for `Closes #N` references
- the branch name if it contains an issue reference

Then fetch the issue with `gh issue view <N> --json number,title,body,state,labels,comments,url`.

## 2. Inspect the change
Read:
- `git diff $(git merge-base HEAD origin/master)...HEAD --stat`
- `git diff $(git merge-base HEAD origin/master)...HEAD --name-status`
- the relevant files changed by the branch, and the tests that cover that behavior

## 3. Evaluate requirements
For each requirement from the issue,
- mark it as ✅ done, ⚠️ partial, or ❌ missing
- explain what is left if partial or missing
- note whether tests cover the success path, refusal path, and regression case

Apply the repo rules from `CLAUDE.md` when relevant:
- tests sit next to the code and should fail without the fix
- no fixed sleeps; wait for events instead
- no retry-only passes are acceptable
- request-path changes need a k6 scenario or a stated reason when they are not run
- changed options/defaults/headers/message types must be reflected in the READMEs and docs
- `packages/**` changes are release-impacting and should not include unrelated edits
- workflow changes must remain pinned to SHAs and cannot bypass checks

## 4. Report
Use sections:
- **Issue**
- **Requirements**
- **Tests**
- **Repository checks**
- **What needs to be done**
- **Summary**

Keep the report evidence-based and state when a check could not be performed because the environment was missing required tools.
