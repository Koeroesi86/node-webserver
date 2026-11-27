import { FRONT_STOP_MARGIN } from '../constants';
import type { PrimaryHookOptions, PrimaryMessage } from '../types';

/**
 * The listeners of the primary on its process, and on the signals its launcher passes on. It passes the signals that stop the server on to the fronts, over the channel to them, as a signal
 * sent to the primary alone does not reach them, and ends with the signal once they did. A second signal is passed on too, which ends a front at once. With `reloadOnSighup` SIGHUP
 * loads the configuration and the servers again. With `enabled` false it adds nothing. Returns a function that takes the listeners off again.
 */
const setupPrimaryHooks = (enabled: boolean, { signals = process, settings, logger, reload, stop }: PrimaryHookOptions): (() => void) => {
  if (!enabled) return () => {};

  const listened: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let stopping = false;
  const listen = (signal: NodeJS.Signals) => {
    // the setting can be another one after a change of the configuration
    if (signal === 'SIGHUP' && settings().reloadOnSighup) return reload();

    const message: PrimaryMessage = { nodeWebserver: 'signal', signal };
    // the fronts end at once on a second one, and are killed soon after when they do not
    if (stopping) return void stop(message, FRONT_STOP_MARGIN);

    stopping = true;
    logger.system(`${signal} received, stopping the fronts once their requests are finished. Another signal to stop ends them at once.`);
    stop(message, settings().shutdownTimeout + FRONT_STOP_MARGIN).then(() => {
      remove();
      logger.flush();
      signals.detach?.();
      process.kill(process.pid, signal);
    });
  };

  const remove = () => {
    listened.forEach((signal) => signals.off(signal, listen));
    process.off('exit', logger.flush);
  };

  listened.forEach((signal) => signals.on(signal, listen));
  process.on('exit', logger.flush);

  return remove;
};

export default setupPrimaryHooks;
