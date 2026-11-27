import findFrontProblems from './find-front-problems';
import type { ServerConfig } from '../types';

const server = (extra: Partial<ServerConfig>): ServerConfig => ({ hostname: 'a.localhost', protocol: 'https', ...extra });

describe('findFrontProblems', () => {
  it('reports a child server', () => {
    expect(findFrontProblems(server({ type: 'child' }), 'a')).toEqual([
      { severity: 'error', server: 'a', setting: 'type', message: expect.stringContaining('one front') },
    ]);
  });

  it.each([
    [server({ type: 'worker' })],
    [server({ type: 'lambda' })],
    [server({ type: 'proxy', proxyOptions: { target: 'http://a.localhost' } })],
    [server({ type: 'proxy', proxyOptions: { dynamic: { token: 'a' } } })],
    [server({ type: 'worker', acme: { email: 'a@localhost', storagePath: '.' } })],
  ])('has nothing against %j', (instance) => {
    expect(findFrontProblems(instance, 'a')).toEqual([]);
  });
});
