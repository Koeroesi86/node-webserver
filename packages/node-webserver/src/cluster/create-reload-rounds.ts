import { RELOAD_DEBOUNCE, RELOAD_ROUND_RETRIES, RELOAD_ROUND_TIMEOUT } from '../constants';
import type { FrontListener, FrontReloadMessage, LoadReport, Logger, PrimaryMessage } from '../types';
import { debounce, getDate } from '../utils';

interface RoundOptions {
  logger: Logger;
  send: (message: PrimaryMessage, index: number) => void;
  /** ends a front, which another one replaces */
  kill: (index: number) => void;
  /** calls `onChange` when one of the files changes, and returns what stops it. Left out when files are not watched. */
  watch?: (files: string[], onChange: () => void) => () => void;
  /** called when a front found that the servers would run on another number of fronts now */
  onRecount?: () => void;
}

interface Round {
  id: number;
  /** the fronts that were asked */
  fronts: number[];
  /** the ones that did not answer yet */
  waiting: Set<number>;
  fingerprints: Set<string>;
  failures: string[];
  /** whether a front found that the servers would run on another number of fronts */
  recount: boolean;
  timer: NodeJS.Timeout;
}

/**
 * Has all fronts load their servers again together. Every front prepares the servers and answers; only when all of them did, with the same fingerprint, they are told to serve them.
 * Otherwise all of them keep serving what they had, so that they never differ because of a reload. One round at a time: what asks for one meanwhile gets another one after it.
 * The primary watches the files the fronts name, and loads nothing itself.
 */
const createReloadRounds = ({ logger, send, kill, watch, onRecount = () => {} }: RoundOptions) => {
  /** the fronts that serve, with what they said last about their files and servers */
  const serving = new Map<number, Pick<LoadReport, 'files'>>();
  /** what the first fronts loaded, which can differ when files changed while they started */
  const loaded = new Set<string>();
  let current: Round | undefined;
  let rounds = 0;
  /** how many rounds in a row ended with fronts that loaded different things */
  let mismatches = 0;
  let pending = false;
  let active = false;
  let stopWatching = () => {};

  const request = () => {
    pending = true;
    if (!active || current || serving.size === 0) return;

    pending = false;
    const fronts = Array.from(serving.keys());
    const id = (rounds += 1);
    const timer = setTimeout(expire, RELOAD_ROUND_TIMEOUT);
    current = { id, fronts, waiting: new Set(fronts), fingerprints: new Set(), failures: [], recount: false, timer };
    fronts.forEach((index) => send({ nodeWebserver: 'prepare', round: id }, index));
  };

  /** a change starts over with the tries */
  const changed = debounce(() => {
    mismatches = 0;
    request();
  }, RELOAD_DEBOUNCE);

  /** watches anew, as the folders a path leads to can be others after a load */
  const rewatch = () => {
    const stopPrevious = stopWatching;
    // the new watchers before the old ones are closed: a change that has not been delivered yet would be dropped with the last watcher of its folder
    stopWatching = watch?.(Array.from(new Set(Array.from(serving.values()).flatMap(({ files }) => files))), changed) ?? (() => {});
    stopPrevious();
  };

  const keep = (round: Round, reason: string) => {
    round.fronts.forEach((index) => send({ nodeWebserver: 'discard', round: round.id }, index));
    logger.error(`[${getDate()}] The servers were not loaded again, the running ones are kept: ${reason}`);
  };

  const retryMismatch = (round: Round) => {
    mismatches += 1;
    const again = mismatches <= RELOAD_ROUND_RETRIES;
    keep(round, `the fronts did not load the same, ${again ? 'trying again' : 'waiting for the next change'}.`);
    pending ||= again;
  };

  const commit = ({ id, fronts }: Round) => {
    mismatches = 0;
    fronts.forEach((index) => send({ nodeWebserver: 'commit', round: id }, index));
    logger.system(`[${getDate()}] The servers were loaded again in ${fronts.length} fronts`);
  };

  /** serves or drops what the fronts prepared, once all of them answered or ended */
  const finish = (round: Round) => {
    if (round.waiting.size > 0) return;

    clearTimeout(round.timer);
    current = undefined;
    if (round.failures.length) keep(round, round.failures.join(', '));
    else if (round.fingerprints.size > 1) retryMismatch(round);
    else commit(round);
    if (round.recount) onRecount();
    if (pending) request();
  };

  const fail = (round: Round, index: number, reason: string) => {
    round.waiting.delete(index);
    round.failures.push(`front ${index + 1} ${reason}`);
  };

  const expire = () => {
    const round = current;
    if (!round) return;

    Array.from(round.waiting).forEach((index) => {
      fail(round, index, 'did not answer in time, and is replaced');
      serving.delete(index);
      kill(index);
    });
    finish(round);
  };

  const answer = (index: number, message: Extract<FrontReloadMessage, { nodeWebserver: 'prepared' | 'prepare-failed' }>) => {
    const round = current;
    if (round?.id !== message.round || !round.waiting.has(index)) return;

    if (message.nodeWebserver === 'prepared') {
      round.waiting.delete(index);
      round.fingerprints.add(message.fingerprint);
    } else {
      round.recount ||= Boolean(message.recount);
      fail(round, index, `could not load them (${message.reason})`);
    }
    finish(round);
  };

  const listener: FrontListener = {
    serving: (index: number, { files, fingerprint }: LoadReport) => {
      serving.set(index, { files });
      rewatch();
      // a front that replaces another one may have loaded something newer than the others run
      if (active) request();
      else loaded.add(fingerprint);
    },
    message: (index, message) => {
      if (message.nodeWebserver === 'reload-request') return request();
      if (message.nodeWebserver !== 'files') return answer(index, message);

      serving.set(index, { files: message.files });
      rewatch();
    },
    exited: (index) => {
      serving.delete(index);
      const round = current;
      if (!round?.waiting.has(index)) return;

      fail(round, index, 'ended');
      finish(round);
    },
  };

  return {
    ...listener,
    request,
    /** to call once the first fronts serve: rounds are run from here on */
    start: () => {
      active = true;
      if (pending || loaded.size > 1) request();
    },
    stop: () => {
      active = false;
      clearTimeout(current?.timer);
      current = undefined;
      stopWatching();
      stopWatching = () => {};
    },
  };
};

export default createReloadRounds;
