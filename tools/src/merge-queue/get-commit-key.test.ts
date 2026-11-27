import { getCommitKey } from './get-commit-key';

describe('getCommitKey', () => {
  const commit = { author: { date: '2026-11-02T08:00:00Z' }, message: 'Add it' };

  it('is the same for a commit with a new sha', () => {
    expect(getCommitKey({ sha: 'before', commit })).toBe(getCommitKey({ sha: 'after', commit }));
  });

  it('differs by the date of the author and by the message', () => {
    const key = getCommitKey({ sha: 'a', commit });

    expect(getCommitKey({ sha: 'a', commit: { ...commit, message: 'Remove it' } })).not.toBe(key);
    expect(getCommitKey({ sha: 'a', commit: { ...commit, author: { date: '2026-11-02T09:00:00Z' } } })).not.toBe(key);
  });
});
