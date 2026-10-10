import type { ResponseEvent } from '../types';

/**
 * the answer for a path that has no file and no worker, given by the static worker, and by the middleware itself when it knows the path is not there.
 * The path is not repeated in the body, as what a client sends must not come back to it as content.
 */
export default function notFoundResponse(): ResponseEvent & { body: string; headers: Record<string, string> } {
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=0',
    },
    body: 'The requested path does not exist.',
    isBase64Encoded: false,
  };
}
