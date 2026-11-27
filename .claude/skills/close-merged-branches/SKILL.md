---
name: close-merged-branches
description: Delete the local branches whose pull request is merged, with a script that decides which, and report what was deleted and what stayed. Trigger "close merged branches", "delete merged branches", "prune branches", "/close-merged-branches".
model: haiku
allowed-tools: Bash
---

The script decides what is merged (`tools/README.md`, "Merged local branches"): do not work it out yourself and do not delete a branch it keeps.

If `node` or `pnpm` is not found, prefix with `export PATH=$HOME/.nvm/versions/node/<node 24>/bin:$HOME/.local/share/pnpm/bin:$PATH`. From the root:

```sh
pnpm --filter @koeroesi86/tools build
GH_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner -q .nameWithOwner)" node tools/dist/scripts/close-merged-branches.js --delete
```

Leave `--delete` out when only asked which branches are merged. Never print the token.

Report the deleted branches with the commit each was at (`git branch <name> <commit>` brings one back) and the kept ones with their reason. If the current branch is kept only because it is checked out, say that switching away and running again judges it. Delete kept branches only when the user then names them. If the script fails, show the error and delete nothing.
