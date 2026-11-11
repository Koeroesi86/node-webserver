#!/usr/bin/env node

import { runCli } from '../cli';

runCli(process.argv, process.env.NODE_WEBSERVER_CONFIG).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
