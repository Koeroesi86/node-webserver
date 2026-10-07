import type { Request } from 'express';
import isWebSocket from './isWebSocket';

describe('isWebSocket', () => {
  const request = (method: string, headers: Record<string, string>) => ({ method, headers } as unknown as Request);

  it('recognises an upgrade request', () => {
    expect(isWebSocket(request('GET', { connection: 'keep-alive, Upgrade', upgrade: 'WebSocket' }))).toBe(true);
  });

  it.each([
    ['not an upgrade connection', 'GET', { connection: 'keep-alive', upgrade: 'websocket' }],
    ['not a websocket upgrade', 'GET', { connection: 'upgrade', upgrade: 'h2c' }],
    ['not a GET request', 'POST', { connection: 'upgrade', upgrade: 'websocket' }],
    ['no headers', 'GET', {}],
  ])('rejects a request that is %s', (_, method, headers) => {
    expect(isWebSocket(request(method, headers))).toBe(false);
  });

  it('handles a header made of many separators quickly', () => {
    const connection = `${' ,'.repeat(50000)}x`;
    const startedAt = Date.now();

    expect(isWebSocket(request('GET', { connection, upgrade: 'websocket' }))).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
