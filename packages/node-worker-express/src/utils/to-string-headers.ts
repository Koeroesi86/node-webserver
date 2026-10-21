import type { IncomingHttpHeaders } from 'http';

const isStringHeaders = (headers: IncomingHttpHeaders): headers is Record<string, string> => Object.values(headers).every((value) => typeof value === 'string');

/**
 * The headers of a request for the worker, which has one string per name. Node already joins a repeated request header into one string, so the headers are passed on as they are.
 * Only a value that is not a string (an array, as for a response with `set-cookie`) is joined, and one without a value left out.
 */
const toStringHeaders = (headers: IncomingHttpHeaders): Record<string, string> =>
  isStringHeaders(headers)
    ? headers
    : Object.fromEntries(
        Object.entries(headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]]))
      );

export default toStringHeaders;
