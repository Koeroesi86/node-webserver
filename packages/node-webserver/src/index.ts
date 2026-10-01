import startServer from './utils/startServer';
import * as ports from './utils/ports';

const api = Object.assign(startServer, { default: startServer, startServer, ports });

export = api;
