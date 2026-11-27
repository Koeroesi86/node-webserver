import type { OpenPullRequest, RunGit } from '../types/merge-queue';

/** replays the commits after oldBase onto the base and pushes them, only when the branch still is the one that was seen. False when they conflict, nothing is pushed then */
export const replayCommits = async (git: RunGit, { headRefName, headRefOid }: OpenPullRequest, oldBase: string, base: string): Promise<boolean> => {
  await git('fetch', 'origin', base, headRefName);
  await git('switch', '--detach', headRefOid);
  const replayed = await git('rebase', '--onto', `origin/${base}`, oldBase).then(
    () => true,
    () => git('rebase', '--abort').then(() => false)
  );

  if (!replayed) return false;

  await git('push', `--force-with-lease=refs/heads/${headRefName}:${headRefOid}`, 'origin', `HEAD:refs/heads/${headRefName}`);

  return true;
};
