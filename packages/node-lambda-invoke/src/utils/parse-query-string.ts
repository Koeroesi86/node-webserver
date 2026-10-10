/** the parameters of a query string the way API Gateway passes them: the last value of a repeated one, and `null` when there are none */
const parseQueryString = (query: string) => {
  const multiValue: Record<string, string[]> = Object.create(null);
  new URLSearchParams(query).forEach((value, key) => {
    multiValue[key] = [...(multiValue[key] ?? []), value];
  });
  const entries = Object.entries(multiValue);

  if (entries.length === 0) return { single: null, multi: null };

  return {
    single: Object.fromEntries(entries.map(([key, values]) => [key, values[values.length - 1]])),
    multi: Object.fromEntries(entries),
  };
};

export default parseQueryString;
