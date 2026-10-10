/** the lowest of the values that are there, undefined when none is */
export const lowest = (values: (number | undefined)[]): number | undefined => {
  const defined = values.filter((value): value is number => value !== undefined);

  return defined.length === 0 ? undefined : Math.min(...defined);
};
