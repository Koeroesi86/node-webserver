import type net from 'net';
import setupShutdown from './setup-shutdown';
import type { ShutdownOptions } from './setup-shutdown';

export interface ProcessHooks {
  /** takes everything off the process again */
  remove: () => void;
  /** takes only the exit listener of the budget off, for the servers that closed while the process goes on */
  removeWorkerBudget: () => void;
}

/**
 * Adds all the listeners a server puts on the process, in one place: the soft shutdown and the exit listener that stops the workers of the budget.
 * With `enabled` false it adds nothing and leaves all of it to the caller.
 */
const setupProcessHooks = (enabled: boolean, servers: net.Server[], workerBudget: { close: () => void }, shutdown: ShutdownOptions): ProcessHooks => {
  const removeWorkerBudget = () => process.off('exit', workerBudget.close);
  if (!enabled) return { remove: () => {}, removeWorkerBudget };

  // before the shutdown: its exit listener flushes the logger, which has to hold what closing the budget logs
  // for all the pools of the budget at once, as they do not stop the workers themselves when the process ends
  process.once('exit', workerBudget.close);
  const removeShutdown = setupShutdown(servers, shutdown);

  return {
    remove: () => {
      removeShutdown();
      removeWorkerBudget();
    },
    removeWorkerBudget,
  };
};

export default setupProcessHooks;
