import findFrontProblems from './find-front-problems';
import type { ServerConfig } from '../types';

const server = (extra: Partial<ServerConfig>): ServerConfig => ({ hostname: 'a.localhost', protocol: 'https', ...extra });

describe('findFrontProblems', () => {
  it.each([
    ['type', server({ type: 'child' })],
    ['acme', server({ type: 'worker', acme: { email: 'a@localhost', storagePath: '.' } })],
    ['proxyOptions.dynamic', server({ type: 'proxy', proxyOptions: { dynamic: { token: 'a' } } })],
  ])('reports %s', (setting, instance) => {
    expect(findFrontProblems(instance, 'a')).toEqual([{ severity: 'error', server: 'a', setting, message: expect.stringContaining('one front') }]);
  });

  it.each([[server({ type: 'worker' })], [server({ type: 'lambda' })], [server({ type: 'proxy', proxyOptions: { target: 'http://a.localhost' } })]])(
    'has nothing against %j',
    (instance) => {
      expect(findFrontProblems(instance, 'a')).toEqual([]);
    }
  );
});
