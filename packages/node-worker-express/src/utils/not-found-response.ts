import type { ResponseEvent } from '../types';

/** the answer for a path that has no file and no worker, given by the static worker, and by the middleware itself when it knows the path is not there */
export default function notFoundResponse(requestPath: string): ResponseEvent & { body: string; headers: Record<string, string> } {
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=0',
    },
    body: `${requestPath} does not exist`,
    isBase64Encoded: false,
  };
}
