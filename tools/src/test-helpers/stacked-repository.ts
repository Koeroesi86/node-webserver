import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from './git-repository';

/**
 * an origin and a clone of it with a stack: `lower` is a commit on master, `child` a commit on `lower` that writes `files`. `lower` was squash merged into master,
 * which then changed `shared.txt`
 */
export const createStack = (files: Record<string, string> = { 'child.txt': 'child' }) => {
  const origin = createRepository();
  origin.commit({ 'shared.txt': 'base' });
  origin.git('branch', '-M', 'master');
  origin.git('switch', '-q', '-c', 'lower');
  const lower = origin.commit({ 'lower.txt': 'first' }, 'lower');
  origin.git('switch', '-q', '-c', 'child');
  const child = origin.commit(files, 'child');
  origin.git('switch', '-q', 'master');
  const master = origin.commit({ 'lower.txt': 'first, then reviewed', 'shared.txt': 'master' }, 'lower (#1)');

  const clone = mkdtempSync(join(tmpdir(), 'clone-'));
  origin.git('clone', '-q', origin.path, clone);
  origin.git('-C', clone, 'config', 'commit.gpgsign', 'false');

  return {
    origin,
    clone,
    lower,
    child,
    master,
    remove: () => {
      origin.remove();
      rmSync(clone, { recursive: true, force: true });
    },
  };
};
