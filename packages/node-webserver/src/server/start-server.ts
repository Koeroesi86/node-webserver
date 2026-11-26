import type { Express } from 'express';
import createServer from './create-server';
import { getRequestedFronts } from '../cluster';
import { hydrateConfiguration } from '../configuration';
import { createLogger } from '../observability';
import { getDate } from '../utils';
import type { Configuration, Logger } from '../types';

export interface StartOptions {
  /** whether the server stops softly on the signals, stops its children and workers when the process ends and flushes the logger then. Defaults to true. False leaves all of it to the caller. */
  processHooks?: boolean;
}

/** Starts a server in this process, with one front whatever `frontProcesses` says: `startCluster` starts several. */
const startServer = async (
  configuration: Partial<Configuration>,
  logger?: Logger,
  { processHooks = true }: StartOptions = {}
): Promise<{ httpApp: Express; httpsApp: Express; reload: () => void; removeProcessHooks: () => void }> => {
  const hydratedConfiguration = hydrateConfiguration(configuration);
  const log = logger ?? createLogger(hydratedConfiguration);

  if (getRequestedFronts(hydratedConfiguration) > 1) {
    log.warning(
      `[${getDate()}] frontProcesses is ${hydratedConfiguration.frontProcesses}, but startServer runs one front process: use startCluster to run several.`
    );
  }

  const { httpApp, httpsApp, reload, removeProcessHooks } = await createServer(configuration, log, { processHooks });

  return { httpApp, httpsApp, reload, removeProcessHooks };
};

export default startServer;
