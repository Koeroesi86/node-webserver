import net from 'net';
import { getServerMetrics } from '@koeroesi86/node-worker-express';
import setupShutdown from './setup-shutdown';
import startServer from './startServer';
import createMockLogger from './mock-logger.test-helper';

// the exit listeners belong to the process, not to the server under test
jest.mock('./setup-shutdown', () => ({ __esModule: true, default: jest.fn() }));

describe('startServer', () => {
  const configuration = { servers: [], portHttp: 0, portHttps: 0, statsDomain: false as const, watchServers: false };

  it('gives every call apps of its own', async () => {
    // the call does not hand its servers back, so the ones that listen are closed through the spy
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const logger = createMockLogger();

    const first = await startServer(configuration, logger);
    const second = await startServer(configuration, logger);
    await Promise.all(listen.mock.contexts.map((server: net.Server) => new Promise((resolve) => server.close(resolve))));
    listen.mockRestore();

    expect(second.httpApp).not.toBe(first.httpApp);
    expect(second.httpsApp).not.toBe(first.httpsApp);
  });

  it('hands its logger on to the shutdown, which flushes it when the process exits', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const logger = createMockLogger();

    await startServer(configuration, logger);
    await Promise.all(listen.mock.contexts.map((server: net.Server) => new Promise((resolve) => server.close(resolve))));
    listen.mockRestore();

    expect(jest.mocked(setupShutdown).mock.calls.at(-1)?.[1]).toMatchObject({ logger });
  });

  it('hands back what takes the process listeners off again', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const remove = jest.fn();
    jest.mocked(setupShutdown).mockReturnValueOnce(remove);

    const server = await startServer(configuration, createMockLogger());
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(server.removeProcessHooks).toBe(remove);
  });

  it('takes its metrics sources and its exit listener away once its servers closed', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const exitListeners = process.listenerCount('exit');
    const sources = () => Object.keys(getServerMetrics().sources);

    await startServer(configuration, createMockLogger());
    expect(sources()).toEqual(expect.arrayContaining(['workers', 'lambdas']));
    expect(process.listenerCount('exit')).toBe(exitListeners + 1);
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(sources()).not.toContain('workers');
    expect(sources()).not.toContain('lambdas');
    expect(process.listenerCount('exit')).toBe(exitListeners);
  });
});
