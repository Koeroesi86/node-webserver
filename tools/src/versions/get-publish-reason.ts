import type { Git, PublishedRelease, WorkspacePackage } from '../types/version';
import { getPackageFamily } from './get-package-family';

/** why the package gets a new version, undefined when the published release is still up to date */
export const getPublishReason = (
  packages: WorkspacePackage[],
  item: WorkspacePackage,
  git: Git,
  published?: PublishedRelease,
  publishAll = false
): string | undefined => {
  if (publishAll) return 'PUBLISH_ALL is set';
  if (!published) return 'never published';
  if (!published.gitHead) return 'the published release has no gitHead';

  const { gitHead } = published;
  const short = gitHead.substring(0, 7);

  if (!git.isKnownCommit(gitHead)) return `the published commit ${short} is not in the history`;

  const changedMember = [...getPackageFamily(packages, item)].find((member) => git.hasChangesSince(gitHead, member.path));

  if (!changedMember) return undefined;

  return changedMember === item ? `changed since ${short}` : `${changedMember.packageJson.name} changed since ${short}`;
};
