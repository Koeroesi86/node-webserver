/**
 * Deletes the local branches whose pull request is merged (tools/README.md#merged-local-branches), for the close-merged-branches skill and by hand.
 *
 * Usage: node close-merged-branches.js [--delete] [base], the base defaults to master. Without --delete the branches are only listed. Run it in the checkout.
 *
 * Environment:
 *  - GH_TOKEN, GITHUB_REPOSITORY: required, the token and the repository (`owner/name`)
 *  - GITHUB_API_URL: defaults to https://api.github.com
 */
import { parseArgs } from 'node:util';
import { closeMergedBranches, createReadGit } from '../branches';
import { readPullRequestTarget } from '../merge-queue';

const { values, positionals } = parseArgs({ options: { delete: { type: 'boolean', default: false } }, allowPositionals: true });
const target = readPullRequestTarget(process.env, positionals[0]);

closeMergedBranches({ ...target, git: createReadGit(process.cwd()), isDeleting: values.delete })
  .then((lines) => lines.forEach((line) => console.log(line)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
