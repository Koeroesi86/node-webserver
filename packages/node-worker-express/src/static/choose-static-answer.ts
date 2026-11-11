import type { Stats } from 'fs';
import isNotModified from './is-not-modified';
import matchesIfRange from './matches-if-range';
import parseRange from './parse-range';
import type { ByteRange } from './parse-range';

export interface StaticAnswer {
  statusCode: 200 | 206 | 304 | 416;
  /** the headers that depend on the status: length and range */
  headers: Record<string, string>;
  /** the part to send, undefined for the whole file */
  range?: ByteRange;
  hasBody: boolean;
}

/** What a request gets for the file: 304 for a validator it has, the part it asks for (206), 416 for one outside of the file, otherwise the whole file. */
const chooseStaticAnswer = (requestHeaders: Record<string, string>, etag: string, { size, mtimeMs }: Stats): StaticAnswer => {
  if (isNotModified(requestHeaders, etag, mtimeMs)) return { statusCode: 304, headers: {}, hasBody: false };

  const range = matchesIfRange(requestHeaders['if-range'], etag, mtimeMs) ? parseRange(requestHeaders.range, size) : undefined;

  if (range === 'unsatisfiable') return { statusCode: 416, headers: { 'Content-Range': `bytes */${size}`, 'Content-Length': '0' }, hasBody: false };

  if (range === undefined) return { statusCode: 200, headers: { 'Content-Length': String(size) }, hasBody: true };

  return {
    statusCode: 206,
    headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(range.end - range.start + 1) },
    range,
    hasBody: true,
  };
};

export default chooseStaticAnswer;
