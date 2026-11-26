import { PLAN_TIMEOUT } from '../constants';
import type { FrontHandle, FrontProcess, ServerPlan } from '../types';
import forkFront from './fork-front';
import isFrontMessage from './is-front-message';

/**
 * What a server of the configuration as it is now would be, as a process of its own finds it: it runs the script of the server, which loads the configuration and the server files anew,
 * and leaves what they run behind in that process.
 */
const requestPlan = (fork: (front: FrontProcess) => FrontHandle = forkFront, timeout = PLAN_TIMEOUT) =>
  new Promise<ServerPlan>((resolve, reject) => {
    const process = fork({ index: 0, count: 1, plan: true });
    const timer = setTimeout(() => {
      reject(new Error(`the process that loads it did not answer within ${timeout} ms`));
      process.kill();
    }, timeout);

    process.onMessage((message) => {
      if (!isFrontMessage(message) || message.nodeWebserver !== 'plan') return;

      clearTimeout(timer);
      resolve(message.plan);
    });
    // without a plan before it, which resolved already otherwise
    process.onExit((code, signal) => {
      clearTimeout(timer);
      reject(new Error(`the process that loads it ended with ${signal ?? `code ${code}`}`));
    });
  });

export default requestPlan;
