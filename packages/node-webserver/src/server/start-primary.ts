import cluster from 'cluster';
import { createFrontSupervisor, createReloadRounds, fingerprintConfiguration, forkFront, readServerVersion } from '../cluster';
import { hydrateConfiguration, inspectConfiguration } from '../configuration';
import { setupPrimaryHooks } from '../lifecycle';
import { reportProblems } from '../problems';
import { watchFiles } from '../reload';
import { FRONT_STOP_MARGIN } from '../constants';
import { getDate } from '../utils';
import type { Cluster, Configuration, Logger, PrimaryMessage } from '../types';
import type { StartOptions } from './start-server';

/** The primary of a server with several fronts: it owns the ports, starts the fronts and supervises them, and serves no request itself. */
const startPrimary = async (configuration: Partial<Configuration>, logger: Logger, { processHooks = true }: StartOptions): Promise<Cluster> => {
  const { reloadOnSighup, shutdownTimeout, watchServers } = hydrateConfiguration(configuration);
  // everything that is wrong is said once, before a front is started
  const { problems, frontCount } = inspectConfiguration(configuration);
  reportProblems(problems, logger);

  // the primary accepts the connections and hands them to the fronts in turn: left to the system, they would pile up on a few. Before the first front, also for Windows
  cluster.schedulingPolicy = cluster.SCHED_RR;
  const rounds = createReloadRounds({
    logger,
    send: (message, index) => supervisor.send(message, index),
    kill: (index) => supervisor.kill(index),
    watch: watchServers ? watchFiles : undefined,
  });
  const supervisor = createFrontSupervisor({
    listener: rounds,
    count: frontCount,
    release: { configuration: fingerprintConfiguration(configuration), version: readServerVersion() },
    fork: forkFront,
    logger,
    onLost: () => {
      logger.error(`[${getDate()}] No front is left to serve.`);
      logger.flush();
      process.exitCode = 1;
      // with an error, so that a service manager starts the server again, which loads what the replacements found
      if (processHooks) process.exit();
    },
  });
  const stop = (message: PrimaryMessage, timeout: number) => {
    rounds.stop();
    return supervisor.stop(message, timeout);
  };
  const removeProcessHooks = setupPrimaryHooks(processHooks, { reloadOnSighup, shutdownTimeout, logger, reload: rounds.request, stop });

  logger.system(`[${getDate()}] Starting the front processes: ${frontCount}`);
  await supervisor.start().catch((error) => {
    rounds.stop();
    removeProcessHooks();
    logger.flush();
    throw error;
  });
  rounds.start();

  return {
    role: 'primary',
    frontCount,
    reload: rounds.request,
    stop: () => stop({ nodeWebserver: 'stop' }, shutdownTimeout + FRONT_STOP_MARGIN),
    removeProcessHooks,
  };
};

export default startPrimary;
