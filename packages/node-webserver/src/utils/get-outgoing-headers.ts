import type { IncomingHttpHeaders } from 'http';
import { HOP_BY_HOP_HEADERS } from '../constants';

/**
 * The headers of a message without the ones that only concern its own connection, and without the ones left out on purpose, as a list of names and values:
 * the names come from the other side, so they are never made properties of an object.
 */
const getOutgoingHeaders = (headers: IncomingHttpHeaders, leaveOut: string[] = []): string[] => {
  // the connection header can name more headers of its own connection
  const named = `${headers.connection ?? ''}`
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const excluded = new Set([...HOP_BY_HOP_HEADERS, ...named, ...leaveOut]);

  return Object.entries(headers)
    .filter(([name]) => !excluded.has(name))
    .flatMap(([name, value]) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).flatMap((one) => [name, one]));
};

export default getOutgoingHeaders;
