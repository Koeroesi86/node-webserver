import { execFileSync } from 'node:child_process';

/** the files that the commits since the merge base with `base` add, and the ones not committed yet, relative to the folder */
export const listAddedFiles = (rootPath: string, base: string): string[] => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: rootPath, encoding: 'utf8' }).trim();
  const lines = (output: string) => output.split('\n').filter(Boolean);

  return [
    ...lines(git('diff', '--name-only', '--diff-filter=A', '--relative', git('merge-base', 'HEAD', base), '--')),
    ...lines(git('ls-files', '--others', '--exclude-standard')),
  ];
};
