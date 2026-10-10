import { EventEmitter } from 'events';
import { Agent } from 'http';
import { middleware } from '@koeroesi86/node-worker-express';
import type { WorkerBudget } from '@koeroesi86/node-worker-express';
import createInstanceHandler from './create-instance-handler';
import retireAgent from './retire-agent';
import type { Request, Response } from 'express';
import type { LoadedInstance, ServerInstance } from '../types';

// the child process and the proxy are started by the middleware, one that leaves the request open is enough here
jest.mock('../middlewares/proxy', () => ({ __esModule: true, default: jest.fn(() => jest.fn()) }));
// the agent of a target is checked by the test of the target store
jest.mock('./retire-agent', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../middlewares/lambda', () => ({ __esModule: true, default: jest.fn(() => Object.assign(jest.fn(), { close: jest.fn() })) }));
jest.mock('@koeroesi86/node-worker-express', () => ({ middleware: jest.fn(() => Object.assign(jest.fn(), { close: jest.fn(async () => {}) })) }));

describe('createInstanceHandler', () => {
  const child = (): ServerInstance => ({
    hostname: 'child.localhost',
    protocol: 'http',
    type: 'child',
    child: Object.assign(new EventEmitter(), { kill: jest.fn() }) as unknown as ServerInstance['child'],
    proxy: { close: jest.fn() } as unknown as ServerInstance['proxy'],
  });

  it('stops a child server once it answered its requests', async () => {
    const instance = child();
    const { handler, close } = createInstanceHandler(instance);
    const response = new EventEmitter() as unknown as Response;
    handler({} as Request, response, jest.fn());
    const closed = jest.fn();

    close(60000).then(closed);
    await new Promise((resolve) => setImmediate(resolve));
    expect(instance.child?.kill).not.toHaveBeenCalled();
    response.emit('close');
    await new Promise((resolve) => setImmediate(resolve));

    expect(instance.child?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(instance.proxy?.close).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('leaves the waiting for the requests of a worker server to its pool', async () => {
    const { close } = createInstanceHandler({ hostname: 'worker.localhost', protocol: 'http', type: 'worker', options: { root: '/' } });

    await close(1000);

    expect(jest.mocked(middleware).mock.results[0].value.close).toHaveBeenCalledWith(1000);
  });

  it('hands every worker server the same budget, so that their workers count together', () => {
    const workerBudget: WorkerBudget = {
      limit: 2,
      join: jest.fn(),
      leave: jest.fn(),
      hasRoom: jest.fn(),
      findIdleWorker: jest.fn(),
      wakeUp: jest.fn(),
      getStats: jest.fn(),
    };
    jest.mocked(middleware).mockClear();

    ['one.localhost', 'two.localhost'].forEach((hostname) =>
      createInstanceHandler({ hostname, protocol: 'http', type: 'worker', options: { root: '/' } }, { workerBudget })
    );

    expect(jest.mocked(middleware).mock.calls.map(([options]) => options.workerBudget)).toEqual([workerBudget, workerBudget]);
  });

  describe('a proxy server', () => {
    const proxy = (hostname = 'proxy.localhost'): ServerInstance => ({
      hostname,
      protocol: 'https',
      type: 'proxy',
      proxyOptions: { dynamic: { token: 'secret-token' } },
    });
    /** a running proxy server that a service registered its target with */
    const register = (instance: ServerInstance): LoadedInstance => ({
      source: 'proxy.js',
      instance,
      files: [],
      handler: jest.fn(),
      close: jest.fn(),
      registeredTarget: () => ({ url: new URL('http://203.0.113.7:8080'), agent: new Agent(), setAt: 1 }),
    });

    it('keeps the target that was registered with the server it replaces', () => {
      const previous = register(proxy());

      const { registeredTarget } = createInstanceHandler(proxy(), { previous });

      expect(registeredTarget?.()).toMatchObject({ url: new URL('http://203.0.113.7:8080'), setAt: 1 });
    });

    it('does not take the target of a server of another host', () => {
      const previous = register(proxy('other.localhost'));

      expect(createInstanceHandler(proxy(), { previous }).registeredTarget?.()).toBeUndefined();
    });

    it('closes the connections to its target once their requests are answered', async () => {
      const previous = register(proxy());
      const { registeredTarget, close } = createInstanceHandler(proxy(), { previous });
      const agent = registeredTarget?.()?.agent;

      await close(1000);

      expect(retireAgent).toHaveBeenCalledWith(agent);
    });
  });
});
