import fs from 'fs/promises';
import type { Dirent } from 'fs';

const collect = async (
  entries: AsyncIterator<Dirent>,
  names: Set<string>,
  limit: number,
  normalize: (name: string) => string
): Promise<Set<string> | undefined> => {
  const { done, value } = await entries.next();
  if (done) return names;

  names.add(normalize(value.name));
  return names.size > limit ? undefined : collect(entries, names, limit, normalize);
};

/**
 * The names in a directory, or `undefined` when it has more than `limit`. The directory is read entry by entry and closed at once when it is too large,
 * so that a directory of millions of files is never held in memory as a whole, as `readdir` would.
 */
export default async function readDirectoryNames(directory: string, limit: number, normalize: (name: string) => string): Promise<Set<string> | undefined> {
  const handle = await fs.opendir(directory);

  // closing a directory that was read to its end rejects, which is of no interest
  return collect(handle[Symbol.asyncIterator](), new Set(), limit, normalize).finally(() => handle.close().catch(() => undefined));
}
