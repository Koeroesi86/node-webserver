import os from 'os';
import splitServerLimits from './split-server-limits';
import type { ServerConfig } from '../types';

const worker = (options: object = {}): ServerConfig => ({ hostname: 'a.localhost', protocol: 'http', type: 'worker', options: { root: '.', ...options } });
const lambda = (lambdaOptions: object = {}): ServerConfig => ({ hostname: 'b.localhost', protocol: 'http', type: 'lambda', lambdaOptions });
const front = { index: 1, count: 2 };

describe('splitServerLimits', () => {
  beforeEach(() => jest.spyOn(os, 'availableParallelism').mockReturnValue(8));
  afterEach(() => jest.restoreAllMocks());

  it('leaves the definition as it is with one front', () => {
    const instance = worker({ limit: 5 });

    expect(splitServerLimits(instance, { index: 0, count: 1 })).toBe(instance);
  });

  it('shares the limits of a worker server', () => {
    expect(splitServerLimits(worker({ limit: 5, limitPerPath: 4 }), front).options).toMatchObject({ limit: 2, limitPerPath: 2 });
  });

  it('shares the default limit for every path, and leaves a server without a limit without one', () => {
    const { options } = splitServerLimits(worker(), front);

    expect(options?.limitPerPath).toBe(4);
    expect(options).not.toHaveProperty('limit');
  });

  it('shares what a function gives a path, at least one worker', () => {
    const { options } = splitServerLimits(worker({ limitPerPath: (path: string) => path.length }), front);
    const limitPerPath = options?.limitPerPath;

    expect(typeof limitPerPath === 'function' && ['', 'abcdef'].map(limitPerPath)).toEqual([1, 3]);
  });

  it('shares the limits of a lambda server and of its routes', () => {
    const routes = [
      { path: '/a', lambda: 'a.js', limit: 3 },
      { path: '/b', lambda: 'b.js' },
    ];

    expect(splitServerLimits(lambda({ limit: 6, routes }), front).lambdaOptions).toMatchObject({
      limit: 3,
      routes: [{ limit: 1 }, { path: '/b', lambda: 'b.js' }],
    });
  });

  it('shares the default limit of a lambda server, and keeps no limit', () => {
    expect([lambda(), lambda({ limit: 0 })].map((instance) => splitServerLimits(instance, front).lambdaOptions?.limit)).toEqual([4, 0]);
  });

  it('leaves the other servers as they are', () => {
    const instance: ServerConfig = { hostname: 'c.localhost', protocol: 'http', type: 'proxy' };

    expect(splitServerLimits(instance, front)).toBe(instance);
  });
});
