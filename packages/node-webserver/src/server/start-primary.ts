import cluster from 'cluster';
import { createFrontSupervisor, fingerprintConfiguration, forkFront, readServerVersion } from '../cluster';
import { hydrateConfiguration, inspectConfiguration } from '../configuration';
import { setupPrimaryHooks } from '../lifecycle';
import { reportProblems } from '../problems';
import { FRONT_STOP_MARGIN } from '../constants';
import { getDate } from '../utils';
import type { Cluster, Configuration, Logger } from '../types';
import type { StartOptions } from './start-server';

/** The primary of a server with several fronts: it owns the ports, starts the fronts and supervises them, and serves no request itself. */
const startPrimary = async (configuration: Partial<Configuration>, logger: Logger, { processHooks = true }: StartOptions): Promise<Cluster> => {
  const { reloadOnSighup, shutdownTimeout } = hydrateConfiguration(configuration);
  // everything that is wrong is said once, before a front is started
  const { problems, frontCount } = inspectConfiguration(configuration);
  reportProblems(problems, logger);

  // the primary accepts the connections and hands them to the fronts in turn: left to the system, they would pile up on a few. Before the first front, also for Windows
  cluster.schedulingPolicy = cluster.SCHED_RR;
  const supervisor = createFrontSupervisor({
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
  const removeProcessHooks = setupPrimaryHooks(processHooks, {
    reloadOnSighup,
    shutdownTimeout,
    logger,
    send: supervisor.send,
    stop: supervisor.stop,
  });

  logger.system(`[${getDate()}] Starting the front processes: ${frontCount}`);
  await supervisor.start().catch((error) => {
    removeProcessHooks();
    logger.flush();
    throw error;
  });

  return {
    role: 'primary',
    frontCount,
    reload: () => supervisor.send({ nodeWebserver: 'reload' }),
    stop: () => supervisor.stop({ nodeWebserver: 'stop' }, shutdownTimeout + FRONT_STOP_MARGIN),
    removeProcessHooks,
  };
};

export default startPrimary;
