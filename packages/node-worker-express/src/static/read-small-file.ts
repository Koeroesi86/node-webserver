import fs from 'fs/promises';
import type { Stats } from 'fs';
import { StaticFileCache } from '../constants';
import createCache from './create-cache';

interface Entry {
  body: Buffer;
  mtimeMs: number;
  size: number;
}

const cache = createCache<Entry>({ maxEntries: StaticFileCache.entries, maxBytes: StaticFileCache.bytes, sizeOf: ({ body }) => body.length });

/** Reads a file that is sent in one part, from memory while its size and modification time are the ones in `stats`. */
const readSmallFile = async (fileName: string, stats: Stats) => {
  const cached = cache.get(fileName);

  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.body;

  cache.delete(fileName);
  const body = await fs.readFile(fileName);
  // a file that changed since it was described is not kept, the next request reads it again
  if (body.length === stats.size) cache.set(fileName, { body, mtimeMs: stats.mtimeMs, size: stats.size });

  return body;
};

export default readSmallFile;
