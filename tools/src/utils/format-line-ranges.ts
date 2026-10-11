/** `[1, 2, 3, 7, 9, 10]` as `1-3, 7, 9-10` */
export const formatLineRanges = (lines: number[]) =>
  lines
    .reduce<number[][]>((ranges, line) => {
      const last = ranges.at(-1);
      return last && last[1] === line - 1 ? [...ranges.slice(0, -1), [last[0], line]] : [...ranges, [line, line]];
    }, [])
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
    .join(', ');
