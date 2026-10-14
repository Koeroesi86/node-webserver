import exampleConfig from '../configuration.example';
import { DEFAULT_SHUTDOWN_TIMEOUT } from '../constants';
import type { Configuration } from '../types';

/** The configuration given over the example one, with the defaults of the options that are left out. */
const hydrateConfiguration = (configuration: Partial<Configuration>) => {
  const hydrated: Configuration = { ...exampleConfig, ...configuration };
  const { watchServers = true, reloadOnSighup = false, trustedProxies = [], shutdownTimeout = DEFAULT_SHUTDOWN_TIMEOUT } = hydrated;

  return { ...hydrated, watchServers, reloadOnSighup, trustedProxies, shutdownTimeout };
};

export default hydrateConfiguration;
