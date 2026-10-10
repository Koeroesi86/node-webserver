import type { OutgoingHttpHeaders } from 'http';
import type ResponseEvent from '../classes/ResponseEvent';

/** the headers of a response: `headers`, the values of `multiValueHeaders` added to them, and the `cookies` as `Set-Cookie` headers */
const createResponseHeaders = ({ headers, multiValueHeaders, cookies }: ResponseEvent): OutgoingHttpHeaders => {
  const result = new Map<string, { name: string; values: string[] }>();
  const add = (name: string, values: string[]) => {
    const entry = result.get(name.toLowerCase()) ?? { name, values: [] };
    entry.values.push(...values);
    result.set(name.toLowerCase(), entry);
  };

  Object.entries(headers ?? {}).forEach(([name, value]) => {
    if (value === undefined) return;
    add(name, Array.isArray(value) ? value : [`${value}`]);
  });
  Object.entries(multiValueHeaders ?? {}).forEach(([name, values]) => add(name, values));
  if (cookies?.length) add('Set-Cookie', cookies);

  return Object.fromEntries(Array.from(result.values()).map(({ name, values }) => [name, values.length === 1 ? values[0] : values]));
};

export default createResponseHeaders;
