import { FRONT_STOP_MARGIN } from '../constants';
import type { PrimaryHookOptions, PrimaryMessage } from '../types';

/**
 * The listeners of the primary on its process. It passes the signals that stop the server on to the fronts, over the channel to them, as a signal sent to the primary alone does not
 * reach them, and ends with the signal once they did. A second signal is passed on too, which ends a front at once. With `reloadOnSighup` SIGHUP reloads the servers of every front.
 * With `enabled` false it adds nothing. Returns a function that takes the listeners off again.
 */
const setupPrimaryHooks = (enabled: boolean, { reloadOnSighup, shutdownTimeout, logger, reload, stop }: PrimaryHookOptions): (() => void) => {
  if (!enabled) return () => {};

  const stopSignals: NodeJS.Signals[] = reloadOnSighup ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let stopping = false;
  const listen = (signal: NodeJS.Signals) => {
    const message: PrimaryMessage = { nodeWebserver: 'signal', signal };
    // the fronts end at once on a second one, and are killed soon after when they do not
    if (stopping) return void stop(message, FRONT_STOP_MARGIN);

    stopping = true;
    logger.system(`${signal} received, stopping the fronts once their requests are finished. Another one of ${stopSignals.join(', ')} ends them at once.`);
    stop(message, shutdownTimeout + FRONT_STOP_MARGIN).then(() => {
      remove();
      logger.flush();
      process.kill(process.pid, signal);
    });
  };

  const remove = () => {
    stopSignals.forEach((signal) => process.off(signal, listen));
    process.off('SIGHUP', reload);
    process.off('exit', logger.flush);
  };

  stopSignals.forEach((signal) => process.on(signal, listen));
  if (reloadOnSighup) process.on('SIGHUP', reload);
  process.on('exit', logger.flush);

  return remove;
};

export default setupPrimaryHooks;
