import { getConfigurationFiles } from '../children';
import { fingerprintConfiguration, getRequestedFronts, readServerVersion } from '../cluster';
import { hydrateConfiguration, inspectConfiguration } from '../configuration';
import { readFingerprint } from '../reload';
import type { Configuration, ServerPlan } from '../types';

/**
 * What the server of the configuration would be, as the primary needs it. It loads the server files, which runs them. `configurationFile` is the file the configuration was loaded from
 * in this process, whose changes the primary watches.
 */
const createServerPlan = (configuration: Partial<Configuration>, configurationFile?: string): ServerPlan => {
  const hydrated = hydrateConfiguration(configuration);
  const { reloadOnSighup, shutdownTimeout, watchServers } = hydrated;
  const files = configurationFile ? getConfigurationFiles(configurationFile) : [];

  return {
    ...inspectConfiguration(configuration),
    balanced: getRequestedFronts(hydrated) > 1,
    release: { configuration: fingerprintConfiguration(configuration), version: readServerVersion() },
    files,
    filesFingerprint: configurationFile ? readFingerprint(files) : undefined,
    settings: { reloadOnSighup, shutdownTimeout, watchServers },
  };
};

export default createServerPlan;
