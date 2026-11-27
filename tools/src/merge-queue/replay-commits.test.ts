import { createPullRequest } from '../test-helpers/fake-github';
import { createStack } from '../test-helpers/stacked-repository';
import { createRemoteGit } from './create-remote-git';
import { replayCommits } from './replay-commits';

describe('replayCommits', () => {
  let stack: ReturnType<typeof createStack>;
  const replay = (headRefOid = stack.child) =>
    replayCommits(createRemoteGit(stack.clone, 'secret'), createPullRequest(2, { headRefName: 'child', headRefOid }), stack.lower, 'master');

  afterEach(() => stack.remove());

  it('pushes the own commits of the branch onto the base', async () => {
    stack = createStack();

    await expect(replay()).resolves.toBe(true);
    expect(stack.origin.git('log', '--format=%s', `${stack.master}..child`)).toBe('child');
    expect(stack.origin.git('diff', '--name-only', stack.master, 'child')).toBe('child.txt');
  });

  it('pushes nothing when the own commits conflict', async () => {
    stack = createStack({ 'shared.txt': 'child' });

    await expect(replay()).resolves.toBe(false);
    expect(stack.origin.git('rev-parse', 'child')).toBe(stack.child);
  });

  it('does not overwrite a branch that moved', async () => {
    stack = createStack();
    stack.origin.git('switch', '-q', 'child');
    const moved = stack.origin.commit({ 'more.txt': 'more' });
    stack.origin.git('switch', '-q', 'master');

    await expect(replay()).rejects.toThrow('stale info');
    expect(stack.origin.git('rev-parse', 'child')).toBe(moved);
  });
});
