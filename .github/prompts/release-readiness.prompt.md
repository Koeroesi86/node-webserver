---
mode: agent
description: Assess whether a change is ready to ship and report affected packages, verification, and release impact.
---

Assess whether the current change is ready to ship.

## 1. Determine release impact
Review the diff and answer:
- which package folders or files changed
- whether any affected file is under `packages/**`, `pnpm-lock.yaml`, or a workflow file
- which packages publish as a result
- whether the change is breaking or non-breaking

Use the repo rules:
- `packages/**` changes publish the package and its dependents
- `pnpm-lock.yaml` can publish packages whose dependencies changed, plus their dependents
- docs, tooling, and CI-only changes usually do not publish packages

## 2. Validate readiness
Check whether the following are covered:
- the scope is narrow and not mixed with unrelated refactors
- tests were added or updated for the code change
- the project checks relevant to the change were run
- the README or docs were updated when options/defaults/headers/message types changed
- release notes or PR notes are truthful about what was verified and what was not

## 3. Report
Use sections:
- **Affected packages**
- **Breaking change**
- **Verification run**
- **Not verified**
- **Docs or metadata updates needed**
- **Ready to ship?**

If a check could not be run because the environment was missing required tools, say so clearly and do not claim release readiness without that caveat.
