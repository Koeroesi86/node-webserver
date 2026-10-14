---
applyTo: "packages/**,pnpm-lock.yaml,.github/workflows/**,tools/src/scripts/version.ts"
---

# Release and package boundary instructions

- Never edit a package version or `gitHead`; the pipeline stamps those values.
- A change inside a package folder usually publishes that package and its dependents.
- Keep unrelated edits out of package folders and lockfile work unless the change truly requires them.
- When a package changes, consider the downstream effect on workspace dependents before shipping.
- Do not broaden the scope of a release change with unrelated refactors.
- Update documentation when an option, default, header, message type or limit changes.
- For workflow changes, keep actions pinned to full commit SHAs and document the version in a comment.
