import type { Configuration, FrontShare } from '../types';
import shareLimit from './share-limit';
import { DEFAULT_MAX_CONNECTIONS } from '../constants';

/** the configuration with the share of a front of the limits at its top level */
const splitConfigurationLimits = <T extends Pick<Configuration, 'workerLimit' | 'maxConnections'>>(configuration: T, front: FrontShare): T => {
  const { workerLimit = 0, maxConnections = DEFAULT_MAX_CONNECTIONS } = configuration;

  return { ...configuration, workerLimit: shareLimit(workerLimit, front), maxConnections: shareLimit(maxConnections, front) };
};

export default splitConfigurationLimits;
