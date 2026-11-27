/**
 * Turns squash auto-merge on for the pull requests with the automerge label and takes the label off, for automerge-label.yml (tools/README.md#merge-queue).
 *
 * Usage: node automerge-label.js [base], the base defaults to master. Exits with 1 when a pull request could not get auto-merge.
 *
 * Environment:
 *  - GH_TOKEN, GITHUB_REPOSITORY: required, the token and the repository (`owner/name`)
 *  - GITHUB_API_URL: defaults to https://api.github.com
 */
import { applyAutomergeLabel, readPullRequestTarget } from '../merge-queue';

applyAutomergeLabel(readPullRequestTarget(process.env, process.argv[2]))
  .then(({ messages, errors }) => {
    messages.forEach((message) => console.log(message));
    errors.forEach((error) => console.error(error));
    process.exitCode = errors.length > 0 ? 1 : 0;
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
