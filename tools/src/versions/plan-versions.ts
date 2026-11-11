import { resolve } from 'node:path';
import type { PlanItem } from '../types/version';
import { createGit } from './create-git';
import { fetchPublishedRelease } from './fetch-published-release';
import { getPublishReason } from './get-publish-reason';
import { readPackages } from './read-packages';

/** which packages of the workspace get a new version, and why */
export const planVersions = async (rootPath: string, registryUrl: string, publishAll = false) => {
  const git = createGit(rootPath);
  const packages = readPackages(resolve(rootPath, 'packages'));
  const publishedList = await Promise.all(packages.map(({ packageJson }) => fetchPublishedRelease(packageJson.name, registryUrl)));
  const plan: PlanItem[] = packages.map((item, index) => ({
    item,
    published: publishedList[index],
    reason: getPublishReason(packages, item, git, publishedList[index], publishAll),
  }));

  return { plan, head: git.head };
};
