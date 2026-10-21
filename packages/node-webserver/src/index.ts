import { startServer } from './server';
import { checkConfiguration, formatProblems, ports } from './utils';

const api = Object.assign(startServer, { default: startServer, startServer, checkConfiguration, formatProblems, ports });

export = api;
