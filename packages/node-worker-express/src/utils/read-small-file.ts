import fs from 'fs/promises';
import type { Stats } from 'fs';
import { StaticFileCache } from '../constants';

interface Entry {
  body: Buffer;
  mtimeMs: number;
  size: number;
}

/** in the order of use, the least recently used first */
const cache = new Map<string, Entry>();
let cachedBytes = 0;

const forget = (fileName: string) => {
  cachedBytes -= cache.get(fileName)?.body.length ?? 0;
  cache.delete(fileName);
};

/** Reads a file that is sent in one part, from memory while its size and modification time are the ones in `stats`. */
const readSmallFile = async (fileName: string, stats: Stats) => {
  const cached = cache.get(fileName);

  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    cache.delete(fileName);
    cache.set(fileName, cached);
    return cached.body;
  }

  forget(fileName);
  const body = await fs.readFile(fileName);
  // a file that changed since it was described is not kept, the next request reads it again
  if (body.length !== stats.size) return body;

  cache.set(fileName, { body, mtimeMs: stats.mtimeMs, size: stats.size });
  cachedBytes += body.length;
  for (const oldest of cache.keys()) {
    if (cache.size <= StaticFileCache.entries && cachedBytes <= StaticFileCache.bytes) break;
    forget(oldest);
  }

  return body;
};

export default readSmallFile;
