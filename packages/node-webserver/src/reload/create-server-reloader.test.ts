import createServerReloader from './create-server-reloader';
import watchFiles from './watch-files';
import createMockLogger from '../observability/mock-logger.test-helper';
import type { Configuration, LoadedInstance, ServerConfig } from '../types';

jest.mock('./watch-files', () => ({ __esModule: true, default: jest.fn() }));

describe('createServerReloader', () => {
  it('watches the files anew before it stops watching them, so that no change is dropped in between', () => {
    const stop = jest.fn();
    jest.mocked(watchFiles).mockReturnValue(stop);
    const reloader = createServerReloader([], {}, true, () => [], createMockLogger());
    reloader.watch();
    jest.mocked(watchFiles).mockClear();

    reloader.watch();

    expect(jest.mocked(watchFiles).mock.invocationCallOrder[0]).toBeLessThan(stop.mock.invocationCallOrder[0]);
  });

  it('keeps the running instances when a reload fails', () => {
    const instance: ServerConfig = { hostname: 'running.localhost', protocol: 'http' };
    const loaded: LoadedInstance = {
      source: instance,
      instance,
      runtime: {},
      handler: (request, response, next) => next(),
      close: async () => undefined,
      files: [],
    };
    const loadInstances = jest.fn((previous: LoadedInstance[]) => {
      if (previous.length > 0) throw new Error('invalid server');
      return [loaded];
    });
    const configuration: Partial<Configuration> = {};
    const reloader = createServerReloader([], configuration, false, loadInstances, createMockLogger());

    reloader.reload();

    expect(loadInstances).toHaveBeenNthCalledWith(1, []);
    expect(loadInstances).toHaveBeenNthCalledWith(2, [loaded]);
    expect(reloader.getLoaded()).toEqual([loaded]);
    expect(reloader.httpHandler).toBeInstanceOf(Function);
    expect(reloader.httpsHandler).toBeInstanceOf(Function);
  });

  const server = (hostname: string) => {
    const instance: ServerConfig = { hostname, protocol: 'http' };
    return { source: instance, instance, runtime: {}, handler: jest.fn(), close: jest.fn(async () => undefined), files: [`${hostname}.js`] };
  };

  const prepared = () => {
    const [running, next] = [server('running.localhost'), server('next.localhost')];
    const loadInstances = jest.fn((previous: LoadedInstance[]) => (previous.length ? [next] : [running]));
    const reloader = createServerReloader([], {}, false, loadInstances, createMockLogger());
    return { reloader, running, next, servers: reloader.prepare() };
  };

  it('starts what is new without serving it, which the exit of the process still reaches', () => {
    const { reloader, running, next, servers } = prepared();

    expect(reloader.getLoaded()).toEqual([running]);
    expect(reloader.getInstances()).toEqual([running, next]);
    expect(servers.instances).toEqual([next]);
    expect(running.close).not.toHaveBeenCalled();
  });

  it('serves what was prepared on commit, and retires what it replaces', async () => {
    const { reloader, running, next, servers } = prepared();

    servers.commit();

    expect(reloader.getLoaded()).toEqual([next]);
    expect(running.close).toHaveBeenCalled();
    expect(reloader.getWatchedFiles()).toEqual(['next.localhost.js']);
    await new Promise(setImmediate);
    expect(reloader.getInstances()).toEqual([next]);
  });

  it('closes what was prepared on discard, and keeps serving what runs', async () => {
    const { reloader, running, next, servers } = prepared();

    servers.discard();

    expect(next.close).toHaveBeenCalledWith(0);
    expect(running.close).not.toHaveBeenCalled();
    expect(reloader.getLoaded()).toEqual([running]);
    await new Promise(setImmediate);
    expect(reloader.getInstances()).toEqual([running]);
  });
});
