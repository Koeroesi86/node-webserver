---
mode: agent
description: Review an issue for ambiguities, inconsistencies, and gaps before implementation begins.
---

Review the issue before it is implemented. Focus on technical ambiguity, scope gaps, and mismatches against the codebase; do not comment on wording or style.

## 1. Get the issue
Use the first valid source:
- the argument, if it is a URL, issue number, or commit hash
- `gh pr view --json closingIssuesReferences`
- `git log origin/master..HEAD --format=%B` for `Closes #N`
- the branch name if it includes an issue reference

Then fetch the issue with `gh issue view <N> --json number,title,body,state,labels,comments,url`.

## 2. Check against the code
Read the parts of the repo the issue touches, especially:
- package `README.md` files
- types and constants used by the changed behavior
- tests covering the functionality
- any matching code in server, worker, lambda, or proxy layers

Verify that the files, options, functions, headers, or message types named by the issue exist and match the actual behavior.

## 3. Analyze the issue
Identify:
- **Ambiguities**: where a requirement can be implemented more than one way or lacks a measurable condition
- **Inconsistencies**: conflicts with the README, architecture, comments, or current behavior
- **Gaps**: missing acceptance criteria, failure/refusal cases, security or resource constraints, cross-platform behavior, performance measurement needs, or necessary documentation updates

Pay special attention to:
- request-path or front-process cost issues
- API defaults and breaking changes
- the need for a reproducible test or k6 scenario
- package publishing impact
- security rules and resource limits

## 4. Report
Use headings:
- **Issue**
- **Ambiguities**
- **Inconsistencies**
- **Gaps**
- **Summary**

Write “none detected” where appropriate and do not invent findings beyond the evidence in the issue and codebase.
