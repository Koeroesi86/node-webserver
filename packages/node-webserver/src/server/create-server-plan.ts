import { getConfigurationFiles } from '../children';
import { fingerprintConfiguration, getRequestedFronts, readServerVersion } from '../cluster';
import { hydrateConfiguration, inspectConfiguration } from '../configuration';
import { readFingerprint } from '../reload';
import type { Configuration, ServerPlan } from '../types';

/**
 * What the server of the configuration would be, as the primary needs it. It loads the server files, which runs them. `configurationFile` is the file the configuration was loaded from
 * in this process, whose changes the primary watches.
 *
 * The primary accepts the connections of several fronts, and on Windows of one too: there a front that accepts itself takes a connection with it when it stops listening, so it could not be
 * replaced without a failed request.
 */
const createServerPlan = (configuration: Partial<Configuration>, configurationFile?: string, platform: NodeJS.Platform = process.platform): ServerPlan => {
  const hydrated = hydrateConfiguration(configuration);
  const { reloadOnSighup, shutdownTimeout, watchServers } = hydrated;
  const files = configurationFile ? getConfigurationFiles(configurationFile) : [];

  return {
    ...inspectConfiguration(configuration),
    balanced: platform === 'win32' || getRequestedFronts(hydrated) > 1,
    release: { configuration: fingerprintConfiguration(configuration), version: readServerVersion() },
    files,
    filesFingerprint: configurationFile ? readFingerprint(files) : undefined,
    settings: { reloadOnSighup, shutdownTimeout, watchServers },
  };
};

export default createServerPlan;
