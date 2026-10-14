import createServerReloader from './create-server-reloader';
import type { Configuration, LoadedInstance, ServerConfig } from '../types';

jest.mock('./logger', () => ({ __esModule: true, default: { system: jest.fn(), error: jest.fn() } }));

describe('createServerReloader', () => {
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
    const reloader = createServerReloader([], configuration, false, loadInstances);

    reloader.reload();

    expect(loadInstances).toHaveBeenNthCalledWith(1, []);
    expect(loadInstances).toHaveBeenNthCalledWith(2, [loaded]);
    expect(reloader.getLoaded()).toEqual([loaded]);
    expect(reloader.httpHandler).toBeInstanceOf(Function);
    expect(reloader.httpsHandler).toBeInstanceOf(Function);
  });
});
