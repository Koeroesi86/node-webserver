import { basename } from 'node:path';

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9-]+)*\.ts$/;

/** the TypeScript files whose name is not kebab-case, so that a file can be told from its export and moved or renamed the same way everywhere */
export const findNameProblems = (files: string[]): string[] =>
  files.filter((file) => file.endsWith('.ts') && !KEBAB_CASE.test(basename(file))).map((file) => `${file}: file names are kebab-case`);
