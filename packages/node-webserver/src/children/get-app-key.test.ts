import getAppKey from './get-app-key';
import type { ServerConfig } from '../types';

describe('getAppKey', () => {
  const server = (extra: Partial<ServerConfig> = {}): ServerConfig => ({
    hostname: 'a.localhost',
    protocol: 'http',
    type: 'child',
    childOptions: { command: 'node', args: (port) => ['app.js', `${port}`] },
    proxyOptions: {},
    serverOptions: { protocol: 'http' },
    ...extra,
  });

  it('is the same for the same application, and names the host', () => {
    expect(getAppKey(server(), 'one')).toBe(getAppKey(server(), 'one'));
    expect(getAppKey(server())).toMatch(/^http a\.localhost [0-9a-f]{64}$/);
  });

  it.each([
    ['another host', server({ hostname: 'b.localhost' }), 'one'],
    ['another protocol', server({ protocol: 'https' }), 'one'],
    ['another command', server({ childOptions: { command: 'deno', args: (port) => ['app.js', `${port}`] } }), 'one'],
    ['other arguments of a function', server({ childOptions: { command: 'node', args: (port) => ['other.js', `${port}`] } }), 'one'],
    ['other arguments', server({ childOptions: { command: 'node', args: ['app.js'] } }), 'one'],
    ['another port', server({ proxyOptions: { port: 1 } }), 'one'],
    ['changed files', server(), 'two'],
  ])('differs for %s', (_, other, fingerprint) => {
    expect(getAppKey(other, fingerprint)).not.toBe(getAppKey(server(), 'one'));
  });
});
