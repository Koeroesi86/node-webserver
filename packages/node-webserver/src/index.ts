import { startCluster, startLauncher, startServer } from './server';
import { checkConfiguration } from './configuration';
import { formatProblems } from './problems';
import { ports } from './utils';
import { getStableScriptPath } from './cluster';

const api = Object.assign(startServer, {
  default: startServer,
  startServer,
  startCluster,
  startLauncher,
  checkConfiguration,
  formatProblems,
  ports,
  getStableScriptPath,
});

export = api;
