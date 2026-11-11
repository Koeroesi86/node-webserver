import { startServer } from './server';
import { checkConfiguration } from './configuration';
import { formatProblems } from './problems';
import { ports } from './utils';

const api = Object.assign(startServer, { default: startServer, startServer, checkConfiguration, formatProblems, ports });

export = api;
