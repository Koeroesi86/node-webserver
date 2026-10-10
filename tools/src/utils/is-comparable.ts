/** a base that cannot serve a route answers with errors, which are fast: the checks of its requests say whether the answers are real ones */
export const isComparable = (p95: number | undefined, checkRate: number | undefined, minCheckRate: number) =>
  p95 !== undefined && (checkRate === undefined || checkRate >= minCheckRate);
