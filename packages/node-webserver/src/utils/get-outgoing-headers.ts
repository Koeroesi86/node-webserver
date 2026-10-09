import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
import { HOP_BY_HOP_HEADERS } from '../constants';

/** the headers of a message without the ones that only concern its own connection, and without the ones left out on purpose */
const getOutgoingHeaders = (headers: IncomingHttpHeaders, leaveOut: string[] = []): OutgoingHttpHeaders => {
  // the connection header can name more headers of its own connection
  const named = `${headers.connection ?? ''}`
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const excluded = new Set([...HOP_BY_HOP_HEADERS, ...named, ...leaveOut]);

  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)));
};

export default getOutgoingHeaders;
