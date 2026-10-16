import { existsSync } from 'fs';
import { resolve } from 'path';

/** `--add` and `--run` would otherwise start a server nobody configured, so a fallback is for the development script only */
const resolveConfigurationPath = (configuration: string | undefined, environment: string | undefined, fallback?: string): string => {
  const given = configuration || environment || fallback;

  if (!given) {
    throw new Error('Give the configuration with --configuration or the NODE_WEBSERVER_CONFIG environment variable.');
  }

  const configPath = resolve(given);

  if (!fallback && !existsSync(configPath)) {
    throw new Error(`Configuration file does not exist: ${configPath}`);
  }

  return configPath;
};

export default resolveConfigurationPath;
