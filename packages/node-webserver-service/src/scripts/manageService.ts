#!/usr/bin/env node

import manageService from '../utils/manage-service';

manageService(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
