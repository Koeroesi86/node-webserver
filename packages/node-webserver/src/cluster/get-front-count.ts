import type { Configuration, ServerConfig } from '../types';
import getRequestedFronts from './get-requested-fronts';
import getServerLimits from './get-server-limits';

const isFixedLimit = (limit: unknown): limit is number => typeof limit === 'number' && limit > 0;

/** how many fronts a server runs: the ones the configuration asks for, but no more than the smallest limit, as every front needs a share of it of at least one */
const getFrontCount = (
  configuration: Pick<Configuration, 'frontProcesses' | 'workerLimit' | 'maxConnections'>,
  servers: Array<ServerConfig | undefined>,
  cores?: number
) => {
  const limits = [configuration.workerLimit, configuration.maxConnections, ...servers.flatMap(getServerLimits)].filter(isFixedLimit);

  return Math.max(1, Math.min(getRequestedFronts(configuration, cores), ...limits));
};

export default getFrontCount;
