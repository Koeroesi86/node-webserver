import createServer from './create-server';
import createFrontReload from './create-front-reload';
import type { RunningServer } from './create-server';
import { createFrontSignals, fingerprintConfiguration, getReleaseChange, isPrimaryMessage, readServerVersion } from '../cluster';
import { getDate } from '../utils';
import type { Cluster, Configuration, FrontMessage, FrontProcess, Logger, PrimaryMessage } from '../types';
import type { StartOptions } from './start-server';

/** resolves once the message left, also when it cannot: a primary that is gone takes the front with it anyway */
const send = (message: FrontMessage) =>
  new Promise<void>((resolve) => {
    if (!process.send) return resolve();
    process.send(message, undefined, undefined, () => resolve());
  });

/** tells the primary why this front does not serve, and ends it */
const leave = async (message: FrontMessage, logger: Logger, code: number): Promise<never> => {
  await send(message);
  logger.flush();
  process.exit(code);
};

/**
 * One of the fronts of a server, which the primary started: it serves like a server of one process, with its share of the limits, and does what the primary tells it.
 * It ends instead when it cannot start, or when it replaces a front and finds another configuration or version than the one that runs.
 */
const startFront = async (
  front: FrontProcess,
  configuration: Partial<Configuration>,
  logger: Logger,
  { processHooks = true }: StartOptions
): Promise<Cluster> => {
  const signals = processHooks ? createFrontSignals() : undefined;
  let running: RunningServer | undefined;
  let rounds: ReturnType<typeof createFrontReload> | undefined;
  const requestReload = () => void send({ nodeWebserver: 'reload-request' });
  const exit = () => {
    logger.flush();
    process.exit(0);
  };
  const stop = () => (running ? running.stop() : Promise.resolve());
  const obey: Record<PrimaryMessage['nodeWebserver'], (message: PrimaryMessage) => unknown> = {
    signal: (message) => message.nodeWebserver === 'signal' && signals?.receive(message.signal),
    prepare: (message) => message.nodeWebserver === 'prepare' && rounds?.prepare(message.round),
    commit: (message) => message.nodeWebserver === 'commit' && rounds?.commit(message.round),
    discard: (message) => message.nodeWebserver === 'discard' && rounds?.discard(message.round),
    stop: () => stop().then(exit),
  };
  process.on('message', (message) => isPrimaryMessage(message) && obey[message.nodeWebserver](message));
  await send({ nodeWebserver: 'hello' });

  const release = { configuration: fingerprintConfiguration(configuration), version: readServerVersion() };
  const change = front.expected && getReleaseChange(front.expected, release);

  if (change) {
    logger.error(`[${getDate()}] This front does not replace the one that ended, as ${change}: restart the server to apply the change.`);
    return leave({ nodeWebserver: 'stale', reason: change }, logger, 0);
  }

  const fail = (error: unknown) => {
    logger.error(`[${getDate()}] The front did not start:`, error);
    return leave({ nodeWebserver: 'failed', reason: error instanceof Error ? error.message : String(error) }, logger, 1);
  };
  // a port that cannot be listened on is an error of the server that nothing catches
  process.once('uncaughtException', fail);
  running = await createServer(configuration, logger, { processHooks, front, signals, stoppable: true, requestReload }).catch(fail);
  process.off('uncaughtException', fail);
  rounds = createFrontReload(running, send, logger);
  await send({ nodeWebserver: 'ready', release, ...running.report() });

  return { role: 'front', frontCount: front.count, reload: requestReload, stop, removeProcessHooks: running.removeProcessHooks };
};

export default startFront;
