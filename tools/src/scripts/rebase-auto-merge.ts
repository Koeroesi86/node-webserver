/**
 * Rebases the pull request whose auto-merge was enabled first onto its base when it is behind, for rebase-auto-merge.yml (tools/README.md#merge-queue).
 *
 * Usage: node rebase-auto-merge.js [base], the base defaults to master. Run it in a checkout of the repository with its history: a stack is replayed there.
 *
 * Environment:
 *  - GH_TOKEN, GITHUB_REPOSITORY: required, the token and the repository (`owner/name`)
 *  - GITHUB_API_URL: defaults to https://api.github.com
 */
import { advanceMergeQueue, createRemoteGit, readPullRequestTarget } from '../merge-queue';

const target = readPullRequestTarget(process.env, process.argv[2]);

advanceMergeQueue({ ...target, git: createRemoteGit(process.cwd(), target.token) })
  .then((message) => console.log(message))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
