const withoutWeakPrefix = (etag: string) => etag.trim().replace(/^W\//, '');

/** Evaluates the conditional request headers like RFC 9110: `If-None-Match` decides when it is there, `If-Modified-Since` only otherwise. */
const isNotModified = (headers: Record<string, string>, etag: string, mtimeMs: number) => {
  const ifNoneMatch = headers['if-none-match'];
  const ifModifiedSince = headers['if-modified-since'];

  if (ifNoneMatch !== undefined) {
    return ifNoneMatch.trim() === '*' || ifNoneMatch.split(',').some((candidate) => withoutWeakPrefix(candidate) === withoutWeakPrefix(etag));
  }

  // dates have a resolution of seconds
  return ifModifiedSince !== undefined && Date.parse(ifModifiedSince) >= Math.floor(mtimeMs / 1000) * 1000;
};

export default isNotModified;
