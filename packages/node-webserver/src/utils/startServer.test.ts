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
    const exitListeners = process.listenerCount('exit');
    jest.mocked(setupShutdown).mockReturnValueOnce(remove);

    const server = await startServer(configuration, createMockLogger());
    server.removeProcessHooks();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(process.listenerCount('exit')).toBe(exitListeners);
  });

  it('leaves the process listeners to the caller when it is told to', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const exitListeners = process.listenerCount('exit');
    jest.mocked(setupShutdown).mockClear();

    const server = await startServer(configuration, createMockLogger(), { processHooks: false });
    const during = process.listenerCount('exit');
    expect(() => server.removeProcessHooks()).not.toThrow();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();

    expect(setupShutdown).not.toHaveBeenCalled();
    expect(during).toBe(exitListeners);
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

  it('leaves the listeners of the process at their start with two servers in one process', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const events = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException'];
    const counts = () => events.map((event) => process.listenerCount(event));
    const start = counts();
    // the real shutdown, as the listeners it adds are what must not be left behind
    jest.mocked(setupShutdown).mockImplementation(jest.requireActual('./setup-shutdown').default);

    const first = await startServer(configuration, createMockLogger());
    const second = await startServer(configuration, createMockLogger());
    const during = counts();
    first.removeProcessHooks();
    second.removeProcessHooks();
    const afterRemove = counts();
    await Promise.all(listen.mock.contexts.map((context: net.Server) => new Promise((resolve) => context.close(resolve))));
    listen.mockRestore();
    jest.mocked(setupShutdown).mockReset();

    expect(during.every((count, index) => count > start[index])).toBe(true);
    expect(afterRemove).toEqual(start);
    expect(counts()).toEqual(start);
  });
});
