/** the headers of a request with the names as the client wrote them (node lowercases them), the last value in `headers`, all of them in `multiValueHeaders` */
const parseRawHeaders = (rawHeaders: string[]) => {
  const byName = new Map<string, { name: string; values: string[] }>();

  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const key = rawHeaders[index].toLowerCase();
    const entry = byName.get(key) ?? { name: rawHeaders[index], values: [] };
    entry.values.push(rawHeaders[index + 1]);
    byName.set(key, entry);
  }

  const entries = Array.from(byName.values());

  return {
    headers: Object.fromEntries(entries.map(({ name, values }) => [name, values[values.length - 1]])),
    multiValueHeaders: Object.fromEntries(entries.map(({ name, values }) => [name, values])),
  };
};

export default parseRawHeaders;
