import { createPullRequest } from '../test-helpers/fake-github';
import { findOldBase } from './find-old-base';
import { rebaseConflicting } from './rebase-conflicting';
import { replayCommits } from './replay-commits';

jest.mock('./find-old-base');
jest.mock('./replay-commits');
jest.useFakeTimers();

describe('rebaseConflicting', () => {
  const queue = { request: jest.fn(), git: jest.fn(), repository: 'owner/name', base: 'master' };
  const pullRequest = createPullRequest(2);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(findOldBase).mockResolvedValue('old');
    jest.mocked(replayCommits).mockResolvedValue(true);
  });

  it('replays the own commits of a branch whose base was squash merged', async () => {
    await expect(rebaseConflicting(queue, pullRequest)).resolves.toBe('Replayed the commits of #2 after old onto master');
    expect(findOldBase).toHaveBeenCalledWith(queue, 2);
    expect(replayCommits).toHaveBeenCalledWith(queue.git, pullRequest, 'old', 'master');
  });

  it('leaves a conflict of the own commits to the author', async () => {
    jest.mocked(replayCommits).mockResolvedValue(false);

    await expect(rebaseConflicting(queue, pullRequest)).resolves.toBe('#2 has a conflict of its own commits, the queue waits for its author');
  });

  it('leaves a conflict without a merged pull request below to the author', async () => {
    jest.mocked(findOldBase).mockResolvedValue(undefined);

    await expect(rebaseConflicting(queue, pullRequest)).resolves.toBe('#2 has a conflict, the queue waits for its author');
    expect(replayCommits).not.toHaveBeenCalled();
  });

  it('does not push to a fork', async () => {
    await expect(rebaseConflicting(queue, createPullRequest(2, { isCrossRepository: true }))).resolves.toBe(
      '#2 has a conflict, the queue waits for its author'
    );
    expect(findOldBase).not.toHaveBeenCalled();
    expect(replayCommits).not.toHaveBeenCalled();
  });
});
