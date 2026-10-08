import { readFileSync } from 'node:fs';

/** the content of the file, undefined when it cannot be read */
export const readFile = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};
