import hasBody from './hasBody';
import type { IncomingMessage } from 'http';

const request = (method?: string) => ({ method } as IncomingMessage);

describe('hasBody', () => {
  it.each(['GET', 'get', 'DELETE', 'OPTIONS', 'HEAD', 'head'])('says %s has no body, whatever the case', (method) => {
    expect(hasBody(request(method))).toBe(false);
  });

  it.each(['POST', 'post', 'PUT', 'PATCH'])('says %s has a body', (method) => {
    expect(hasBody(request(method))).toBe(true);
  });

  it('treats a request without a method as a GET', () => {
    expect(hasBody(request(undefined))).toBe(false);
  });
});
