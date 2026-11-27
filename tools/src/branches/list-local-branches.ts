import type { LocalBranch, ReadGit } from '../types/branches';

export const listLocalBranches = (git: ReadGit): LocalBranch[] =>
  git('for-each-ref', '--format=%(refname:lstrip=2)%09%(objectname)%09%(worktreepath)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    // the last field is empty without a worktree, and then trimmed off the last line
    .map(([name, sha, worktreePath]) => ({ name, sha, isCheckedOut: Boolean(worktreePath) }));
