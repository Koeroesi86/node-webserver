import { existsSync } from 'fs';
import { resolve } from 'path';

/** there is no example server to fall back to: starting or installing a server nobody configured is a mistake */
const resolveConfigurationPath = (configuration: string | undefined, environment: string | undefined): string => {
  const given = configuration || environment;

  if (!given) {
    throw new Error('Give the configuration with --config or the NODE_WEBSERVER_CONFIG environment variable.');
  }

  const configPath = resolve(given);

  if (!existsSync(configPath)) {
    throw new Error(`Configuration file does not exist: ${configPath}`);
  }

  return configPath;
};

export default resolveConfigurationPath;
