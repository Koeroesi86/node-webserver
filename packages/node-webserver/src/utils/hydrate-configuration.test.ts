import { DEFAULT_SHUTDOWN_TIMEOUT } from '../constants';
import hydrateConfiguration from './hydrate-configuration';

describe('hydrateConfiguration', () => {
  it('fills the options that are left out with their defaults', () => {
    expect(hydrateConfiguration({})).toMatchObject({
      watchServers: true,
      reloadOnSighup: false,
      trustedProxies: [],
      shutdownTimeout: DEFAULT_SHUTDOWN_TIMEOUT,
    });
  });

  it('keeps the options that are given', () => {
    expect(hydrateConfiguration({ watchServers: false, reloadOnSighup: true, shutdownTimeout: 5, portHttp: 1234 })).toMatchObject({
      watchServers: false,
      reloadOnSighup: true,
      shutdownTimeout: 5,
      portHttp: 1234,
    });
  });
});
