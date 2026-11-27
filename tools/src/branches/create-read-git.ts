import { execFileSync } from 'node:child_process';
import type { ReadGit } from '../types/branches';

/** git in the folder. What it prints on stderr goes into the error instead of the output of the run */
export const createReadGit =
  (rootPath: string): ReadGit =>
  (...args) =>
    execFileSync('git', args, { cwd: rootPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
