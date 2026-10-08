/** the change from the base to the head in percent, with a sign */
export const formatChange = (base: number | undefined, head: number | undefined) =>
  base === undefined || head === undefined || base === 0 ? 'n/a' : `${head >= base ? '+' : '−'}${Math.abs(((head - base) / base) * 100).toFixed(1)}%`;
