import { createPullRequest } from '../test-helpers/fake-github';
import { replayCommits } from './replay-commits';

jest.useFakeTimers();

describe('replayCommits', () => {
  const git = jest.fn<Promise<void>, string[]>();
  const replay = () => replayCommits(git, createPullRequest(2, { headRefName: 'child', headRefOid: 'head' }), 'old', 'master');
  const upToRebase = [
    ['fetch', 'origin', 'master', 'child'],
    ['switch', '--detach', 'head'],
    ['rebase', '--onto', 'origin/master', 'old'],
  ];
  const push = ['push', '--force-with-lease=refs/heads/child:head', 'origin', 'HEAD:refs/heads/child'];
  /** git fails for the command, and for no other one */
  const failFor = (failing: string) =>
    git.mockImplementation(async (command) => {
      if (command === failing) throw new Error(`git ${failing} failed`);
    });

  beforeEach(() => {
    git.mockReset().mockResolvedValue(undefined);
  });

  it('replays the commits after the old base onto the base and pushes them over the head that was seen', async () => {
    await expect(replay()).resolves.toBe(true);
    expect(git.mock.calls).toEqual([...upToRebase, push]);
  });

  it('aborts the rebase and pushes nothing when the commits conflict', async () => {
    git.mockImplementation(async (...args) => {
      if (args[1] === '--onto') throw new Error('conflict');
    });

    await expect(replay()).resolves.toBe(false);
    expect(git.mock.calls).toEqual([...upToRebase, ['rebase', '--abort']]);
  });

  it('fails when git refuses the push', async () => {
    failFor('push');

    await expect(replay()).rejects.toThrow('git push failed');
  });

  it('rebases and pushes nothing when the branches cannot be fetched', async () => {
    failFor('fetch');

    await expect(replay()).rejects.toThrow('git fetch failed');
    expect(git).toHaveBeenCalledTimes(1);
  });
});
