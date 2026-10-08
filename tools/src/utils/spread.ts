export const spread = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);

  return known.length === 0 ? undefined : { min: Math.min(...known), max: Math.max(...known) };
};
