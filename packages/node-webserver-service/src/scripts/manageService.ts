#!/usr/bin/env node

import service from 'os-service';
import { existsSync } from 'fs';
import parseArgv from '../utils/parseArgv';
import start from '../utils/start';
import { DEFAULT_CONFIGURATION_PATH } from '../constants';
import type { ServiceConfiguration } from '../types';

const { add, remove, run, configuration } = parseArgv();

const configPath = (typeof configuration === 'string' && configuration) || process.env.NODE_WEBSERVER_CONFIG || DEFAULT_CONFIGURATION_PATH;

if (!existsSync(configPath)) {
  throw new Error(`Configuration file does not exist: ${configPath}`);
}

const Configuration: ServiceConfiguration = require(configPath);

const handleError = (error?: Error): void => {
  if (error) {
    console.trace(error);
  }
};

if (add) {
  service.add(
    Configuration.serviceName,
    {
      displayName: Configuration.serviceDisplayName || Configuration.serviceName,
      programPath: __filename,
      programArgs: ['--run', ...process.argv.slice(3)],
    },
    handleError
  );
} else if (remove) {
  service.remove(Configuration.serviceName, handleError);
} else if (run) {
  start(configPath);
  service.run(() => {
    service.stop(0);
  });
} else {
  console.info(
    '\x1b[32m%s\x1b[0m',
    `
    Usage:
    
    pnpm run service [argument]
    
    arguments:
        --add      Installs the service
        --remove   Removes the service
        --run      Attempt to run the program as a service
    `
  );
}
