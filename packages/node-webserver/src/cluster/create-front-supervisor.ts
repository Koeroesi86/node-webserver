import { FRONT_MIN_UPTIME, FRONT_STOP_MARGIN } from '../constants';
import type { FrontHandle, FrontListener, FrontMessage, FrontProcess, FrontRelease, Logger, PrimaryMessage } from '../types';
import { getDate } from '../utils';
import getRestartDelay from './get-restart-delay';
import isFrontMessage from './is-front-message';

interface SupervisorOptions {
  /** how many fronts run */
  count: number;
  /** what the primary was started from */
  release: FrontRelease;
  fork: (front: FrontProcess) => FrontHandle;
  logger: Logger;
  /** called when a replacement found something else than what runs, and none is started in its place */
  onStale: () => void;
  /** what is told about the fronts */
  listener: FrontListener;
}

/** one of the places for a front, which the front that replaces another one takes over with its share of the limits */
interface Slot {
  index: number;
  handle?: FrontHandle;
  startedAt: number;
  /** how many fronts in a row ended too soon */
  failures: number;
  /** why the front said it does not serve */
  reason?: string;
  /** the front is not to be replaced, as another one would find the same */
  stale: boolean;
  /** waits until the front is replaced */
  timer?: NodeJS.Timeout;
}

interface Start {
  releases: FrontRelease[];
  resolve: () => void;
  reject: (error: Error) => void;
}

const isSameRelease = (first: FrontRelease, second: FrontRelease) => first.configuration === second.configuration && first.version === second.version;

/** Starts the fronts, replaces the ones that end, and stops them. It serves nothing itself. */
const createFrontSupervisor = ({ count, release, fork, logger, onStale, listener }: SupervisorOptions) => {
  const slots: Slot[] = Array.from({ length: count }, (_, index) => ({ index, startedAt: 0, failures: 0, stale: false }));
  const stopped: Array<() => void> = [];
  /** set until all the first fronts serve */
  let starting: Start | undefined;
  /** set once the fronts are stopped, for good */
  let stopping: PrimaryMessage | undefined;
  /** what the replacements have to find */
  let expected: FrontRelease | undefined;
  let killTimer: NodeJS.Timeout | undefined;

  const name = ({ index, handle }: Slot) => `Front ${index + 1} (pid ${handle?.pid})`;

  /** to one front, or to all of them */
  const send = (message: PrimaryMessage, index?: number) =>
    slots.filter((slot) => index === undefined || slot.index === index).forEach(({ handle }) => handle?.send(message));

  const finishStop = () => {
    if (slots.some(({ handle }) => handle)) return;

    clearTimeout(killTimer);
    stopped.splice(0).forEach((resolve) => resolve());
  };

  /** asks the fronts to leave and kills the ones that are still there after `timeout` milliseconds. Resolves once all of them ended. */
  const stop = (message: PrimaryMessage, timeout: number) => {
    stopping = message;
    slots.forEach(({ timer }) => clearTimeout(timer));
    send(message);
    clearTimeout(killTimer);
    killTimer = setTimeout(() => slots.forEach(({ handle }) => handle?.kill()), timeout);
    const done = new Promise<void>((resolve) => stopped.push(resolve));
    finishStop();

    return done;
  };

  /** the configuration can load differently every time (a value made when it is loaded), a replacement would never find it again then */
  const settleStart = ({ releases, resolve }: Start) => {
    starting = undefined;
    expected = releases.every((found) => isSameRelease(found, release)) ? release : undefined;
    if (!expected) logger.warning(`[${getDate()}] The fronts did not load the same configuration, so replacements are not compared with it.`);
    resolve();
  };

  const serve = (slot: Slot, { release: found, files, fingerprint, singleFrontOnly }: Extract<FrontMessage, { nodeWebserver: 'ready' }>) => {
    logger.system(`[${getDate()}] ${name(slot)} is serving`);
    listener.serving(slot.index, { files, fingerprint, singleFrontOnly });
    starting?.releases.push(found);
    if (starting?.releases.length === count) settleStart(starting);
  };

  const receive = (slot: Slot, message: FrontMessage) => {
    if (message.nodeWebserver === 'ready') return serve(slot, message);
    // a front that is started while the others are stopped is told once it listens
    if (message.nodeWebserver === 'hello') return stopping && slot.handle?.send(stopping);
    // a plan comes from a process of its own, which is no front
    if (message.nodeWebserver === 'plan') return undefined;
    if (message.nodeWebserver !== 'failed' && message.nodeWebserver !== 'stale') return listener.message(slot.index, message);

    slot.reason = message.reason;
    slot.stale = message.nodeWebserver === 'stale';
  };

  const failStart = ({ reject }: Start, slot: Slot, status: string) => {
    starting = undefined;
    const error = new Error(`Front ${slot.index + 1} did not start: ${slot.reason ?? `its process ended with ${status}`}`);
    stop({ nodeWebserver: 'stop' }, FRONT_STOP_MARGIN).then(() => reject(error));
  };

  const giveUp = (slot: Slot) => {
    logger.system(`[${getDate()}] Front ${slot.index + 1} is not replaced, as ${slot.reason}`);
    onStale();
  };

  const launch = (slot: Slot) => {
    const handle = fork({ index: slot.index, count, ...(expected && { expected }) });
    Object.assign(slot, { handle, startedAt: Date.now(), reason: undefined, stale: false, timer: undefined });
    logger.system(`[${getDate()}] ${name(slot)} started`);
    handle.onMessage((message) => isFrontMessage(message) && receive(slot, message));
    handle.onExit((code, signal) => exited(slot, String(signal ?? `code ${code}`)));
  };

  const replace = (slot: Slot, status: string) => {
    slot.failures = Date.now() - slot.startedAt >= FRONT_MIN_UPTIME ? 1 : slot.failures + 1;
    const delay = getRestartDelay(slot.failures);
    logger.error(`[${getDate()}] Front ${slot.index + 1} ended with ${status}, another one is started in ${delay} ms`);
    slot.timer = setTimeout(launch, delay, slot);
  };

  const exited = (slot: Slot, status: string) => {
    slot.handle = undefined;
    listener.exited(slot.index);
    if (stopping) return finishStop();
    if (starting) return failStart(starting, slot, status);

    return slot.stale ? giveUp(slot) : replace(slot, status);
  };

  return {
    /** resolves once all the fronts serve. A front that ends before that stops all of them, and rejects. */
    start: () =>
      new Promise<void>((resolve, reject) => {
        starting = { releases: [], resolve, reject };
        slots.forEach(launch);
      }),
    send,
    stop,
    /** whether no front runs and none is going to be started */
    isEmpty: () => slots.every(({ handle, timer }) => !handle && !timer),
    /** ends the front at once, which another one replaces */
    kill: (index: number) => slots[index]?.handle?.kill(),
  };
};

export default createFrontSupervisor;
