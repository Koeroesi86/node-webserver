import createServer from './create-server';
import startFront from './start-front';
import startPrimary from './start-primary';
import { getFrontProcess, getRequestedFronts } from '../cluster';
import { hydrateConfiguration } from '../configuration';
import { createLogger } from '../observability';
import type { Cluster, Configuration, Logger } from '../types';
import type { StartOptions } from './start-server';

/** the server of one front, in this process, without a primary */
const startSingle = async (configuration: Partial<Configuration>, logger: Logger | undefined, { processHooks }: StartOptions): Promise<Cluster> => {
  const { reload, stop, removeProcessHooks } = await createServer(configuration, logger, { processHooks, stoppable: true });

  return { role: 'single', frontCount: 1, reload, stop, removeProcessHooks };
};

/**
 * Starts a server with as many front processes as `frontProcesses` asks for, as the limits and the cores allow. With one it is a server in this process, as `startServer` starts it.
 * With more this process becomes their primary, and runs this script again for each of them (`node:cluster`), where this function starts the front. Resolves once all fronts serve.
 */
const startCluster = async (configuration: Partial<Configuration>, logger?: Logger, options: StartOptions = {}): Promise<Cluster> => {
  const front = getFrontProcess();
  const hydratedConfiguration = hydrateConfiguration(configuration);

  if (front) return startFront(front, configuration, logger ?? createLogger(hydratedConfiguration), options);
  if (getRequestedFronts(hydratedConfiguration) <= 1) return startSingle(configuration, logger, options);

  return startPrimary(configuration, logger ?? createLogger(hydratedConfiguration, 'primary'), options);
};

export default startCluster;
