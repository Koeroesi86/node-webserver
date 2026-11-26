import type { RunningServer } from './create-server';
import { getDate } from '../utils';
import type { FrontMessage, Logger, PreparedServers } from '../types';

/**
 * The part of a front in a reload: it prepares the servers when the primary asks for it, and serves them or closes them when the primary says so, which it does once every front answered.
 * After every load it tells the primary which files to watch.
 */
const createFrontReload = (server: Pick<RunningServer, 'prepare' | 'report'>, send: (message: FrontMessage) => unknown, logger: Logger) => {
  let held: { round: number; servers: PreparedServers } | undefined;

  const sendFiles = () => send({ nodeWebserver: 'files', files: server.report().files });

  /** serves or closes what is held for the round, which may be nothing when this front failed to prepare it */
  const settle = (round: number, how: 'commit' | 'discard') => {
    if (held?.round !== round) return;

    const { servers } = held;
    held = undefined;
    servers[how]();
    sendFiles();
  };

  return {
    prepare: (round: number) => {
      // a round that the primary gave up on without a word that arrived
      held?.servers.discard();
      held = undefined;
      try {
        const servers = server.prepare();
        held = { round, servers };
        send({ nodeWebserver: 'prepared', round, fingerprint: server.report(servers).fingerprint });
      } catch (error) {
        logger.error(`[${getDate()}] The servers could not be loaded again:`, error);
        send({ nodeWebserver: 'prepare-failed', round, reason: error instanceof Error ? error.message : String(error) });
        sendFiles();
      }
    },
    commit: (round: number) => settle(round, 'commit'),
    discard: (round: number) => settle(round, 'discard'),
  };
};

export default createFrontReload;
