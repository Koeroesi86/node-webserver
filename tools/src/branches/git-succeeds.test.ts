import { gitSucceeds } from './git-succeeds';

jest.useFakeTimers();

describe('gitSucceeds', () => {
  it('is true when git does not fail', () => {
    const git = jest.fn().mockReturnValue('');

    expect(gitSucceeds(git, 'cat-file', '-e', 'abc')).toBe(true);
    expect(git).toHaveBeenCalledWith('cat-file', '-e', 'abc');
  });

  it('is false when git fails', () => {
    const git = jest.fn(() => {
      throw new Error('exit code 1');
    });

    expect(gitSucceeds(git, 'cat-file', '-e', 'abc')).toBe(false);
  });
});
