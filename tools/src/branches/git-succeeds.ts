import type { ReadGit } from '../types/branches';

/** whether git exits with 0, for the questions it answers with its exit code */
export const gitSucceeds = (git: ReadGit, ...args: string[]): boolean => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};
