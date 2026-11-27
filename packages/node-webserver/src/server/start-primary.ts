import cluster from 'cluster';
import createServerPlan from './create-server-plan';
import { connectLauncher, createFrontSet, createFrontsManager, forkFront, getLauncherMode, readServerVersion, requestPlan } from '../cluster';
import { setupPrimaryHooks } from '../lifecycle';
import { reportProblems } from '../problems';
import { readFingerprint, watchFiles } from '../reload';
import { FRONT_STOP_MARGIN, RESTART_EXIT_CODE } from '../constants';
import { getDate } from '../utils';
import type { Cluster, ClusterOptions, Configuration, Logger } from '../types';

/**
 * The primary of a server: it owns the ports, starts the fronts, supervises them and takes them through the changes of the configuration, and serves no request itself.
 * With one front the front accepts the connections itself, which costs nothing per connection. With several, and on Windows, the primary does (see `createServerPlan`).
 */
const startPrimary = async (
  configuration: Partial<Configuration>,
  logger: Logger,
  { processHooks = true, configurationFile }: ClusterOptions
): Promise<Cluster> => {
  // everything that is wrong is said once, before a front is started
  const plan = createServerPlan(configuration, configurationFile);
  reportProblems(plan.problems, logger);

  // handed to the fronts in turn, left to the system they would pile up on a few of several. Set before the first front, also for Windows, and for as long as the primary runs
  cluster.schedulingPolicy = plan.balanced ? cluster.SCHED_RR : cluster.SCHED_NONE;
  const launcher = getLauncherMode() ? connectLauncher() : undefined;
  const exit = (code: number) => {
    logger.flush();
    process.exit(code);
  };
  const manager = createFrontsManager({
    logger,
    version: plan.release.version,
    createSet: (next, events) => createFrontSet({ plan: next, fork: forkFront, logger, watch: watchFiles, ...events }),
    requestPlan,
    watch: watchFiles,
    fingerprint: readFingerprint,
    restart: launcher && (() => exit(RESTART_EXIT_CODE)),
    onLost: () => {
      logger.error(`[${getDate()}] No front is left to serve.`);
      logger.flush();
      process.exitCode = 1;
      // with an error, so that a service manager starts the server again
      if (processHooks) process.exit();
    },
  });
  const settings = () => (manager.getPlan() ?? plan).settings;
  const removeProcessHooks = setupPrimaryHooks(processHooks, {
    signals: launcher?.signals,
    settings,
    logger,
    reload: manager.reload,
    stop: manager.stop,
  });

  logger.system(`[${getDate()}] Starting the front processes: ${plan.frontCount}`);
  await manager.start(plan).catch(async (error) => {
    await manager.stop({ nodeWebserver: 'stop' }, FRONT_STOP_MARGIN);
    removeProcessHooks();
    logger.flush();
    throw error;
  });
  await launcher?.serving();

  return {
    role: 'primary',
    get frontCount() {
      return (manager.getPlan() ?? plan).frontCount;
    },
    reload: manager.reload,
    stop: () => manager.stop({ nodeWebserver: 'stop' }, settings().shutdownTimeout + FRONT_STOP_MARGIN),
    removeProcessHooks,
  };
};

export default startPrimary;
