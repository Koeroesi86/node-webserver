import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import type { Git } from '../types/version';

/** the questions about the commits of the repository in the folder that the version script asks */
export const createGit = (rootPath: string): Git => {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: rootPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const head = git('rev-parse', 'HEAD');

  return {
    head,
    isKnownCommit: (sha) => {
      try {
        git('cat-file', '-e', `${sha}^{commit}`);
        return true;
      } catch {
        return false;
      }
    },
    hasChangesSince: (sha, path) => git('diff', '--name-only', sha, head, '--', relative(rootPath, path)) !== '',
  };
};
