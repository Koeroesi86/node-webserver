import checkConfiguration from './utils/check-configuration';
import formatProblems from './utils/format-problems';
import startServer from './utils/startServer';
import * as ports from './utils/ports';

const api = Object.assign(startServer, { default: startServer, startServer, checkConfiguration, formatProblems, ports });

export = api;
