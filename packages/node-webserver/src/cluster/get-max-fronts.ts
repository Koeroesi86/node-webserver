import os from 'os';
import { MAX_FRONT_PROCESSES } from '../constants';

/** the most fronts a machine with these cores runs */
const getMaxFronts = (cores = os.availableParallelism()) => Math.min(MAX_FRONT_PROCESSES, cores);

export default getMaxFronts;
