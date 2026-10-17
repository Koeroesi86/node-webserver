#!/usr/bin/env node

import { resolve } from 'path';
import startServer, { checkConfiguration, formatProblems } from '@koeroesi86/node-webserver';
import parseArgv from '../utils/parseArgv';

const { config, check } = parseArgv();

if (typeof config !== 'string') {
  throw new Error('use with --config </path/to/config> [--check]');
}

(async () => {
  await new Promise((r) => setTimeout(r, 1));
  const configuration: Parameters<typeof startServer>[0] = require(resolve(config));

  if (!check) {
    await startServer(configuration);
    return;
  }

  // nothing is started, and the exit status says whether the configuration would start
  const problems = checkConfiguration(configuration);
  const failed = problems.some(({ severity }) => severity === 'error');

  if (problems.length) console.error(formatProblems(problems));
  if (!failed) console.log(`${config} is valid.`);
  process.exitCode = failed ? 1 : 0;
})();
