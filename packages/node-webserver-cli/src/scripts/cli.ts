#!/usr/bin/env node

import { resolve } from 'path';
import startServer from '@koeroesi86/node-webserver';
import parseArgv from '../utils/parseArgv';

const { config } = parseArgv();

if (typeof config !== 'string') {
  throw new Error('use with --config </path/to/config>');
}

(async () => {
  await new Promise((r) => setTimeout(r, 1));
  const configuration: Parameters<typeof startServer>[0] = require(resolve(config));
  await startServer(configuration);
})();
