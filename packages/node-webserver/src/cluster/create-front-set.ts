import type { FrontSetOptions, PrimaryMessage } from '../types';
import createFrontSupervisor from './create-front-supervisor';
import createReloadRounds from './create-reload-rounds';

/** The fronts that serve one configuration, with their supervision and the reloads of their servers. A change of the configuration starts another set next to it. */
const createFrontSet = ({ plan, fork, logger, services, watch, onStale, onRecount }: FrontSetOptions) => {
  const rounds = createReloadRounds({
    logger,
    send: (message, index) => supervisor.send(message, index),
    kill: (index) => supervisor.kill(index),
    watch: plan.settings.watchServers ? watch : undefined,
    onRecount,
  });
  const supervisor = createFrontSupervisor({ count: plan.frontCount, release: plan.release, fork, logger, services, onStale, listener: rounds });
  const stop = (message: PrimaryMessage, timeout: number) => {
    rounds.stop();
    return supervisor.stop(message, timeout);
  };

  return {
    /** resolves once all fronts serve, and rejects when one of them does not start, with all of them stopped */
    start: () =>
      supervisor.start().then(rounds.start, (error) => {
        rounds.stop();
        throw error;
      }),
    stop,
    reload: rounds.request,
    isEmpty: supervisor.isEmpty,
    isSingleFrontOnly: rounds.isSingleFrontOnly,
  };
};

export default createFrontSet;
