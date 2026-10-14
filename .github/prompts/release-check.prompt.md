---
mode: agent
description: Check whether a change is release-impacting and what needs verification
---

Review the current change and determine:

- whether it touches a publishable package, a dependency boundary, or the lockfile
- which packages are affected by this change
- whether the change is breaking or non-breaking
- which verification commands are required for the affected area
- whether docs or metadata also need updating

Then report the affected packages and the minimum verification needed before calling the change ready.

If the change is limited to tooling, docs or CI-only files, say that it does not publish packages.
