import { setTimeout as sleep } from 'node:timers/promises';
import { serverReadyAttempts, serverReadyIntervalMs } from '../constants/load-test';
import { isServerUp } from './is-server-up';

/** polls the server until it answers, or gives up after the attempts, which is found out by the first request that fails */
export const waitForServer = async (port: string, attempts = serverReadyAttempts, intervalMs = serverReadyIntervalMs): Promise<void> => {
  if (attempts === 0 || (await isServerUp(port))) return;
  await sleep(intervalMs);

  return waitForServer(port, attempts - 1, intervalMs);
};
