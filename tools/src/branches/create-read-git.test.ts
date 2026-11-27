import { execFileSync } from 'node:child_process';
import { createReadGit } from './create-read-git';

jest.mock('node:child_process');
jest.useFakeTimers();

describe('createReadGit', () => {
  beforeEach(() => jest.resetAllMocks());

  it('gives what git printed in the folder, without the line break at the end', () => {
    jest.mocked(execFileSync).mockReturnValue('abc\n');

    expect(createReadGit('/repository')('rev-parse', 'HEAD')).toBe('abc');
    expect(execFileSync).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], expect.objectContaining({ cwd: '/repository' }));
  });

  it('fails when git does', () => {
    jest.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a commit');
    });

    expect(() => createReadGit('/repository')('rev-parse', 'nothing')).toThrow('not a commit');
  });
});
