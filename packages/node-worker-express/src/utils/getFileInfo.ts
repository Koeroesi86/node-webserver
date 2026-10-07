import fs from 'fs/promises';
import path from 'path';
import type { Stats } from 'fs';
import getCharset from './getCharset';
import getContentType from './getContentType';

export interface FileInfo {
  etag: string;
  contentType: string;
  /** only detected for text, an empty string otherwise */
  charset: string;
}

const maxEntries = 1000;
const cache = new Map<string, FileInfo & { mtimeMs: number; size: number }>();

const isText = (contentType: string) => contentType.startsWith('text/') || /(json|javascript|xml|svg)/.test(contentType);

/** a weak validator that does not need to read the file, it changes whenever the size or the modification time does */
export const getEtag = ({ size, mtimeMs }: Stats) => `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;

/** the beginning is enough to find a byte order mark */
const readHead = async (fileName: string) => {
  const handle = await fs.open(fileName, 'r');

  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/** Describes a file for its response headers, what needs more than the stats is kept until the file changes. */
const getFileInfo = async (fileName: string, stats: Stats): Promise<FileInfo> => {
  const cached = cache.get(fileName);

  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached;
  }

  const contentType = getContentType(path.extname(fileName));
  const info = {
    etag: getEtag(stats),
    contentType,
    charset: isText(contentType) ? await getCharset(await readHead(fileName), fileName) : '',
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };

  cache.delete(fileName);
  cache.set(fileName, info);
  if (cache.size > maxEntries) {
    // the oldest entry goes first
    cache.delete(cache.keys().next().value);
  }

  return info;
};

export default getFileInfo;
