export interface ByteRange {
  start: number;
  /** inclusive */
  end: number;
}

/**
 * The single range of a `Range` header for a file of `size` bytes. `undefined` when the header is to be ignored (no header, another unit, several ranges,
 * which are answered with the whole file, or a syntax that is not valid) and `'unsatisfiable'` when it lies outside of the file.
 */
const parseRange = (header: string | undefined, size: number): ByteRange | 'unsatisfiable' | undefined => {
  const [, first, last] = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header ?? '') ?? [];

  if (first === undefined || (first === '' && last === '')) return undefined;

  // a suffix: the last bytes
  if (first === '') {
    const length = Number(last);

    return length === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(size - length, 0), end: size - 1 };
  }

  const start = Number(first);
  const end = last === '' ? size - 1 : Number(last);

  if (end < start && last !== '') return undefined;

  return start >= size ? 'unsatisfiable' : { start, end: Math.min(end, size - 1) };
};

export default parseRange;
