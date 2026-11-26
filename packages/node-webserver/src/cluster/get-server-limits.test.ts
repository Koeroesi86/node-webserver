import getServerLimits from './get-server-limits';
import type { ServerConfig } from '../types';

const server = (extra: Partial<ServerConfig>): ServerConfig => ({ hostname: 'a.localhost', protocol: 'http', ...extra });

describe('getServerLimits', () => {
  it('has the limit of a worker server and its limit for every path', () => {
    expect(getServerLimits(server({ type: 'worker', options: { root: '.', limit: 6, limitPerPath: 3 } }))).toEqual([6, 3]);
  });

  it('counts a path limit of 0 as the single worker it keeps', () => {
    expect(getServerLimits(server({ type: 'worker', options: { root: '.', limitPerPath: 0 } }))).toEqual([undefined, 1]);
  });

  it('leaves out a path limit that is a function, which every front gets a worker of at least', () => {
    expect(getServerLimits(server({ type: 'worker', options: { root: '.', limitPerPath: () => 1 } }))).toEqual([undefined, undefined]);
  });

  it('has the limit of a lambda server and of its routes', () => {
    const lambdaOptions = {
      limit: 5,
      routes: [
        { path: '/a', lambda: 'a.js', limit: 2 },
        { path: '/b', lambda: 'b.js' },
      ],
    };

    expect(getServerLimits(server({ type: 'lambda', lambdaOptions }))).toEqual([5, 2, undefined]);
  });

  it.each([[server({ type: 'proxy' })], [server({})], [undefined]])('has none for %j', (instance) => {
    expect(getServerLimits(instance)).toEqual([]);
  });
});
