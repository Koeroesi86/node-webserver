/** the parameters of a query string the way API Gateway passes them: the last value of a repeated one, and `null` when there are none */
const parseQueryString = (query: string) => {
  // a map, as a name like `__proto__` must stay a plain parameter and not become a property that is written to
  const multiValue = new Map<string, string[]>();
  new URLSearchParams(query).forEach((value, key) => {
    multiValue.set(key, [...(multiValue.get(key) ?? []), value]);
  });
  const entries = Array.from(multiValue.entries());

  if (entries.length === 0) return { single: null, multi: null };

  return {
    single: Object.fromEntries(entries.map(([key, values]) => [key, values[values.length - 1]])),
    multi: Object.fromEntries(entries),
  };
};

export default parseQueryString;
