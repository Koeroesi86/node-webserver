import createServer from './create-server';
import createFrontReload from './create-front-reload';
import type { RunningServer } from './create-server';
import {
  createFrontTargets,
  createMergedSignals,
  fingerprintConfiguration,
  getReleaseChange,
  isPrimaryMessage,
  readServerVersion,
  sendMessage as send,
} from '../cluster';
import { getDate } from '../utils';
import type { Cluster, ClusterOptions, Configuration, FrontMessage, FrontProcess, Logger, PrimaryMessage } from '../types';

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
  { processHooks = true }: ClusterOptions
): Promise<Cluster> => {
  const signals = processHooks ? createMergedSignals() : undefined;
  let running: RunningServer | undefined;
  let rounds: ReturnType<typeof createFrontReload> | undefined;
  const requestReload = () => void send({ nodeWebserver: 'reload-request' });
  const exit = () => {
    logger.flush();
    process.exit(0);
  };
  const stop = () => (running ? running.stop() : Promise.resolve());
  const targets = createFrontTargets((message) => void send(message));
  let welcome = () => {};
  /** resolves once the primary told the registered targets, which the servers start with */
  const welcomed = new Promise<void>((resolve) => (welcome = resolve));
  const obey: Record<PrimaryMessage['nodeWebserver'], (message: PrimaryMessage) => unknown> = {
    signal: (message) => message.nodeWebserver === 'signal' && signals?.receive(message.signal),
    prepare: (message) => message.nodeWebserver === 'prepare' && rounds?.prepare(message.round),
    commit: (message) => message.nodeWebserver === 'commit' && rounds?.commit(message.round),
    discard: (message) => message.nodeWebserver === 'discard' && rounds?.discard(message.round),
    stop: () => stop().then(exit),
    targets: (message) => {
      if (message.nodeWebserver !== 'targets') return;
      targets.receive(message.changes);
      welcome();
    },
  };
  // from here on the channel keeps the front running, which it does not until the server starts. Node does not take it back by itself once it was let go, and nothing else
  // may be there while a port is waited for
  process.channel?.ref();
  process.on('message', (message) => isPrimaryMessage(message) && obey[message.nodeWebserver](message));
  await send({ nodeWebserver: 'hello' });

  const release = { configuration: fingerprintConfiguration(configuration), version: readServerVersion() };
  const change = front.expected && getReleaseChange(front.expected, release);

  if (change) {
    logger.system(`[${getDate()}] This front does not replace the one that ended, as ${change}: the primary looks at the change.`);
    return leave({ nodeWebserver: 'stale', reason: change }, logger, 0);
  }

  const fail = (error: unknown) => {
    logger.error(`[${getDate()}] The front did not start:`, error);
    return leave({ nodeWebserver: 'failed', reason: error instanceof Error ? error.message : String(error) }, logger, 1);
  };
  // a port that cannot be listened on is an error of the server that nothing catches
  process.once('uncaughtException', fail);
  await welcomed;
  running = await createServer(configuration, logger, { processHooks, front, signals, stoppable: true, requestReload, sharedTargets: targets }).catch(fail);
  process.off('uncaughtException', fail);
  rounds = createFrontReload(running, send, logger);
  await send({ nodeWebserver: 'ready', release, ...running.report() });

  return { role: 'front', frontCount: front.count, reload: requestReload, stop, removeProcessHooks: running.removeProcessHooks };
};

export default startFront;
