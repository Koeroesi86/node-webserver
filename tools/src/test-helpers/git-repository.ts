import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** a git repository in a temporary folder, with a way to commit files and to remove it again */
export const createRepository = () => {
  const path = mkdtempSync(join(tmpdir(), 'repository-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: path,
      encoding: 'utf8',
    }).trim();
  git('init', '-q');

  return {
    path,
    /** writes the files (path to content), commits them and gives the sha of the commit */
    commit: (files: Record<string, string>, message = 'commit') => {
      Object.entries(files).forEach(([file, content]) => {
        mkdirSync(dirname(join(path, file)), { recursive: true });
        writeFileSync(join(path, file), content);
      });
      git('add', '-A');
      git('commit', '-q', '-m', message);

      return git('rev-parse', 'HEAD');
    },
    remove: () => rmSync(path, { recursive: true, force: true }),
  };
};
