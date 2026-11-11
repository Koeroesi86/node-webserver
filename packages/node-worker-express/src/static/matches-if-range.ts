const withoutWeakPrefix = (etag: string) => etag.trim().replace(/^W\//, '');

/**
 * Whether the `Range` header is to be used: without `If-Range` it is, with one the file must be the one the client has a part of.
 * The validator is compared without the weak prefix, as the `ETag` of the static worker is derived from the size and the modification time, and the same bytes are sent for it.
 */
const matchesIfRange = (ifRange: string | undefined, etag: string, mtimeMs: number) => {
  if (ifRange === undefined) return true;

  if (/^(W\/)?"/.test(ifRange.trim())) return withoutWeakPrefix(ifRange) === withoutWeakPrefix(etag);

  // dates have a resolution of seconds
  return Date.parse(ifRange) === Math.floor(mtimeMs / 1000) * 1000;
};

export default matchesIfRange;
