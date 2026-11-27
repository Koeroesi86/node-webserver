import startFront from './start-front';
import startPlan from './start-plan';
import startPrimary from './start-primary';
import { getFrontProcess } from '../cluster';
import { hydrateConfiguration } from '../configuration';
import { createLogger } from '../observability';
import type { Cluster, ClusterOptions, Configuration, Logger } from '../types';

/**
 * Starts a server behind a primary, with as many front processes as `frontProcesses` asks for, as the limits and the cores allow. This process becomes the primary and runs this script again
 * for each front (`node:cluster`), where this function starts the front, and to look at the configuration when it changes. Resolves once all fronts serve.
 */
const startCluster = async (configuration: Partial<Configuration>, logger?: Logger, options: ClusterOptions = {}): Promise<Cluster> => {
  const front = getFrontProcess();

  if (front?.plan) return startPlan(configuration, options.configurationFile);

  const hydratedConfiguration = hydrateConfiguration(configuration);

  if (front) return startFront(front, configuration, logger ?? createLogger(hydratedConfiguration), options);

  return startPrimary(configuration, logger ?? createLogger(hydratedConfiguration, 'primary'), options);
};

export default startCluster;
