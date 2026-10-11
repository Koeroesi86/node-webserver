---
paths:
  - "packages/**"
  - "pnpm-lock.yaml"
  - "tools/src/scripts/version.ts"
  - ".github/workflows/publish.yml"
---

# Versions and publishing

- Never edit a package's `version` or `gitHead`; the pipeline stamps them (`tools/src/scripts/version.ts`).
- A change in a package folder publishes it and its dependents: keep unrelated edits out of `packages/**`.
- `publish.yml` runs twice a day and by hand, builds and packs without the provenance permission, and a job that runs no repository code publishes the tarballs. Keep it that way.
