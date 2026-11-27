import { getStableScriptPath, startLauncher } from './launcher';
import { ports } from './utils';

// the rest of the server is loaded when it is used: the process of the launcher imports this entry too, and stays a small one without it
const loadServer = (): typeof import('./server') => require('./server');
const loadConfiguration = (): typeof import('./configuration') => require('./configuration');
const loadProblems = (): typeof import('./problems') => require('./problems');

const startServer: ReturnType<typeof loadServer>['startServer'] = async (...args) => loadServer().startServer(...args);
const startCluster: ReturnType<typeof loadServer>['startCluster'] = async (...args) => loadServer().startCluster(...args);
const checkConfiguration: ReturnType<typeof loadConfiguration>['checkConfiguration'] = (...args) => loadConfiguration().checkConfiguration(...args);
const formatProblems: ReturnType<typeof loadProblems>['formatProblems'] = (...args) => loadProblems().formatProblems(...args);

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
