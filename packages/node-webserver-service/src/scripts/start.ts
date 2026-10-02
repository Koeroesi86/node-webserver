import { copyFileSync, existsSync } from 'fs';
import parseArgv from '../utils/parseArgv';
import start from '../utils/start';
import { DEFAULT_CONFIGURATION_PATH } from '../constants';

const { configuration } = parseArgv();

const configPath = (typeof configuration === 'string' && configuration) || process.env.NODE_WEBSERVER_CONFIG || DEFAULT_CONFIGURATION_PATH;

if (!existsSync(configPath)) {
  copyFileSync(DEFAULT_CONFIGURATION_PATH, configPath);
}

start(configPath);
