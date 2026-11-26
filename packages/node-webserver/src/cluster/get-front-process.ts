import cluster from 'cluster';
import { FRONT_PROCESS_ENV } from '../constants';
import type { FrontProcess } from '../types';

const given = cluster.isWorker ? process.env[FRONT_PROCESS_ENV] : undefined;
// read and removed when the module is loaded, before the environment is copied for a worker, a lambda or a child process, which are no fronts
delete process.env[FRONT_PROCESS_ENV];
const front: FrontProcess | undefined = given ? JSON.parse(given) : undefined;

/** the place of this process among the fronts of a server, undefined when it is not a front */
const getFrontProcess = () => front;

export default getFrontProcess;
