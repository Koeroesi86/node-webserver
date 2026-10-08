export const median = (values: (number | undefined)[]): number | undefined => {
  const sorted = values.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
