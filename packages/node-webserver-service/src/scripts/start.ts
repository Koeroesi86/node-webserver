import { copyFileSync, existsSync } from 'fs';
import { parseArguments, resolveConfigurationPath, start } from '../utils';
import { DEFAULT_CONFIGURATION_PATH } from '../constants';

const { configuration } = parseArguments(process.argv.slice(2));

const configPath = resolveConfigurationPath(configuration, process.env.NODE_WEBSERVER_CONFIG, DEFAULT_CONFIGURATION_PATH);

if (!existsSync(configPath)) {
  copyFileSync(DEFAULT_CONFIGURATION_PATH, configPath);
}

start(configPath).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
