import type net from 'net';
import addExitListeners from './exit-handler';
import createServerStop from './create-server-stop';
import type { LoadedInstance, Logger, ServerState, SignalSource } from '../types';

export interface ShutdownOptions {
  reloadOnSighup: boolean;
  shutdownTimeout: number;
  reload: () => void;
  getLoaded: () => LoadedInstance[];
  getInstances: () => ServerState[];
  logger: Logger;
  /** the soft stop of the servers, made here by default */
  gracefulStop?: (timeout: number) => Promise<void>;
  /** where SIGINT, SIGTERM and SIGHUP come from, the process by default */
  signals?: SignalSource;
}

/** Stops the servers softly on SIGINT, SIGTERM and, unless it reloads the configuration, SIGHUP. Returns a function that takes these listeners off the process again. */
const setupShutdown = (
  servers: net.Server[],
  { reloadOnSighup, shutdownTimeout, reload, getLoaded, getInstances, logger, gracefulStop, signals }: ShutdownOptions
): (() => void) => {
  const stop = gracefulStop ?? createServerStop(servers, getLoaded);
  const source: SignalSource = signals ?? process;
  const removeExitListeners = addExitListeners(logger, getInstances, {
    exitOnHangUp: !reloadOnSighup,
    gracefulStop: () => stop(shutdownTimeout),
    signals: source,
  });
  if (reloadOnSighup) source.on('SIGHUP', reload);

  return () => {
    removeExitListeners();
    source.off('SIGHUP', reload);
  };
};

export default setupShutdown;
