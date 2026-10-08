import { createRepository } from '../test-helpers/git-repository';
import { createGit } from './create-git';

describe('createGit', () => {
  const repository = createRepository();
  const first = repository.commit({ 'packages/a/index.js': '1', 'packages/b/index.js': '1' });
  const second = repository.commit({ 'packages/a/index.js': '2' });

  afterAll(() => repository.remove());

  it('knows the commit that is checked out', () => {
    expect(createGit(repository.path).head).toBe(second);
  });

  it('knows which commits are in the history', () => {
    const git = createGit(repository.path);

    expect(git.isKnownCommit(first)).toBe(true);
    expect(git.isKnownCommit('0000000000000000000000000000000000000000')).toBe(false);
    expect(git.isKnownCommit('not a commit')).toBe(false);
  });

  it('knows whether a folder changed since a commit', () => {
    const git = createGit(repository.path);

    expect(git.hasChangesSince(first, `${repository.path}/packages/a`)).toBe(true);
    expect(git.hasChangesSince(first, `${repository.path}/packages/b`)).toBe(false);
    expect(git.hasChangesSince(second, `${repository.path}/packages/a`)).toBe(false);
  });
});
