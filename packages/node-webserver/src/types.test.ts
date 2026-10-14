import type { LoadedInstance, ServerConfig, ServerInstance, ServerRuntime } from './types';

describe('server type model', () => {
  it('keeps declarative config separate from runtime state', () => {
    const config: ServerConfig = {
      hostname: 'example.localhost',
      protocol: 'https',
      type: 'proxy',
      proxyOptions: { target: 'http://example.com' },
    };

    const runtime: ServerRuntime = {
      url: 'https://example.localhost',
      secureContext: {} as never,
      proxy: {} as never,
    };

    const instance: ServerInstance = { ...config, ...runtime };
    const loaded: LoadedInstance = {
      handler: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      source: config,
      instance,
      files: [],
    };

    expect(instance.hostname).toBe('example.localhost');
    expect(loaded.instance.url).toBe('https://example.localhost');
  });
});
