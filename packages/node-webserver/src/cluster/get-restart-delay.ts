import { FRONT_RESTART_BACKOFF } from '../constants';

/** how long a front that ended too soon `failures` times in a row waits for its replacement: the first one is replaced at once, as a worker that crashes is */
const getRestartDelay = (failures: number) => (failures < 2 ? 0 : Math.min(FRONT_RESTART_BACKOFF.max, FRONT_RESTART_BACKOFF.base * 2 ** (failures - 2)));

export default getRestartDelay;
