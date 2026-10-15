---
paths:
  - ".github/**"
---

# Workflows (`.github/`)

- Pin every action to a full commit SHA with the full release as a comment (`uses: owner/action@<sha> # v1.2.3`), never a moving tag like `# v1`: it drifts from the commit and zizmor fails the security check. Dependabot updates them after a 7 day wait.
- `permissions: contents: read` at the top, wider on the job that needs it with a comment why. `persist-credentials: false` on every checkout. Never interpolate `${{ ... }}` of untrusted input into `run:`; pass it through `env:`.
- Run `zizmor .github` (offline works) before a PR that touches a workflow. The only check master requires is `required-checks` in `pr-checks.yml`: a new must-pass job goes into its `needs`.
- No bypass flags or skipped checks (`--no-verify`, `continue-on-error`) to make something pass; find out why it fails. `continue-on-error` stays only where a comment explains it (informational comparisons).
