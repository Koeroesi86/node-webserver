import type { ResponseEvent } from '../types';

/** the body goes over the channel as bytes, which spares the server decoding base64 */
export default function toResponseMessage({ isBase64Encoded, body, ...rest }: ResponseEvent) {
  return {
    ...rest,
    body: typeof body === 'string' ? Buffer.from(body, isBase64Encoded ? 'base64' : 'utf8') : body,
  };
}
