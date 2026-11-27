import { FRONT_STOP_MARGIN, RELOAD_DEBOUNCE } from '../constants';
import type { Logger, ManagedSet, PrimaryMessage, ServerPlan } from '../types';
import { debounce, getDate } from '../utils';
import decideChange from './decide-change';

interface ManagerOptions {
  logger: Logger;
  /** of the package the primary runs */
  version: string;
  createSet: (plan: ServerPlan, events: { onStale: () => void; onRecount: () => void }) => ManagedSet;
  /** what a server of the configuration as it is now would be */
  requestPlan: () => Promise<ServerPlan>;
  /** calls `onChange` when one of the files of the configuration changes, and returns what stops it */
  watch: (files: string[], onChange: () => void) => () => void;
  /** what the files are now, to tell whether they changed since a plan was made */
  fingerprint: (files: string[]) => string | undefined;
  /** ends the server for it to be started again, once the fronts stopped. Left out when nothing would start it. */
  restart?: () => void;
  /** called when no front serves and none is going to */
  onLost: () => void;
}

interface Running {
  set: ManagedSet;
  plan: ServerPlan;
}

/**
 * Runs the fronts of the server through the changes of its configuration: it starts a new set of fronts next to the one that serves, and stops the old one once the new one serves.
 * A set that does not start is dropped, and the old one goes on. What cannot be done side by side restarts the whole server.
 */
const createFrontsManager = ({ logger, version, createSet, requestPlan, watch, fingerprint, restart, onLost }: ManagerOptions) => {
  /** every set that has processes: the one that serves, the one that starts and the ones that still stop */
  const sets = new Set<ManagedSet>();
  let running: Running | undefined;
  let stopped = false;
  /** whether it is a signal that stops it, which a restart must not get in the way of */
  let signalled = false;
  let stopWatching = () => {};
  /** the changes are looked at one after the other */
  let chain: Promise<unknown> = Promise.resolve();
  /** the look that waits for its turn, which what comes meanwhile joins */
  let queued: { force: boolean; done: Promise<boolean> } | undefined;

  const create = (plan: ServerPlan) => {
    const set: ManagedSet = createSet(plan, {
      onStale: () => void (running?.set === set && change(true)),
      onRecount: () => void (running?.set === set && change()),
    });
    sets.add(set);
    return set;
  };

  const stopSets = (message: PrimaryMessage, timeout: number) => Promise.all(Array.from(sets, (set) => set.stop(message, timeout))).then(() => undefined);

  const unwatch = () => {
    stopWatching();
    stopWatching = () => {};
  };

  const changed = debounce(() => void change(), RELOAD_DEBOUNCE);

  const rewatch = (files: string[]) => {
    const stopPrevious = stopWatching;
    // the new watchers before the old ones are closed, so that no change is dropped in between
    stopWatching = running?.plan.settings.watchServers && files.length ? watch(files, changed) : () => {};
    stopPrevious();
  };

  const serve = (set: ManagedSet, plan: ServerPlan) => {
    running = { set, plan };
    rewatch(plan.files);
    // the files can have changed while the fronts started
    if (plan.filesFingerprint !== undefined && fingerprint(plan.files) !== plan.filesFingerprint) void change();
  };

  const retire = ({ set, plan }: Running) =>
    set.stop({ nodeWebserver: 'stop' }, plan.settings.shutdownTimeout + FRONT_STOP_MARGIN).then(() => sets.delete(set));

  const switchTo = async (plan: ServerPlan, previous: Running) => {
    logger.system(`[${getDate()}] The configuration is applied with new front processes: ${plan.frontCount}`);
    const set = create(plan);
    try {
      await set.start();
    } catch (error) {
      sets.delete(set);
      logger.error(`[${getDate()}] The change was not applied, the running fronts are kept:`, error);
      return false;
    }
    if (stopped) return false;

    serve(set, plan);
    logger.system(`[${getDate()}] The new front processes serve, the old ones stop once their requests are answered`);
    void retire(previous);

    return true;
  };

  const restartServer = async (reason: string, { plan }: Running) => {
    if (!restart) {
      logger.error(`[${getDate()}] Restart the server to apply the change, as ${reason}. The running fronts are kept.`);
      return false;
    }

    logger.system(`[${getDate()}] The server restarts, as ${reason}: it takes no new connections until the new one serves`);
    stopped = true;
    unwatch();
    await stopSets({ nodeWebserver: 'stop' }, plan.settings.shutdownTimeout + FRONT_STOP_MARGIN);
    if (!signalled) restart();

    return true;
  };

  /** resolves with whether new fronts serve, or the server restarts */
  const apply = async (force: boolean, previous: Running): Promise<boolean> => {
    const plan = await requestPlan();
    if (stopped) return false;

    const decision = decideChange({ running: previous.plan, next: plan, version, force });

    if (decision.action === 'switch') return switchTo(plan, previous);
    if (decision.action === 'restart') return restartServer(decision.reason, previous);
    if (decision.action === 'invalid') {
      const problems = plan.problems.filter(({ severity }) => severity === 'error').map(({ server, setting, message }) => [server, setting, message]);
      logger.error(
        `[${getDate()}] The configuration was not applied, the running fronts are kept: ${problems.map((parts) => parts.filter(Boolean).join(' ')).join('; ')}`
      );
      // a file it loads now can be the one to fix
      rewatch(Array.from(new Set([...previous.plan.files, ...plan.files])));
    }

    return false;
  };

  const evaluate = async (force: boolean) => {
    const previous = running;
    if (stopped || !previous) return false;

    const done = await apply(force, previous).catch((error) => {
      logger.error(`[${getDate()}] The configuration could not be loaded, the running fronts are kept:`, error);
      return false;
    });
    if (!stopped && running?.set.isEmpty()) onLost();

    return done;
  };

  /** looks at the configuration as it is now, and applies what changed */
  const change = (force = false): Promise<boolean> => {
    if (queued) {
      queued.force ||= force;
      return queued.done;
    }

    const entry = { force, done: Promise.resolve(false) };
    entry.done = chain.then(() => {
      queued = undefined;
      return evaluate(entry.force);
    });
    queued = entry;
    chain = entry.done;

    return entry.done;
  };

  return {
    /** resolves once the fronts of the plan serve, and rejects when they do not start */
    start: (plan: ServerPlan) => {
      const set = create(plan);
      const started = set.start().then(() => serve(set, plan));
      chain = started.catch(() => undefined);

      return started;
    },
    /** loads the servers again in every set of fronts, also the one that starts */
    reloadFronts: () => sets.forEach((set) => set.reload()),
    /** applies what changed since the fronts were started, the installed server included, and leaves everything as it is otherwise */
    check: () => change(),
    /** applies a change of the configuration, and otherwise loads the servers again */
    reload: () => void change().then((applied) => !applied && !stopped && running?.set.reload()),
    stop: (message: PrimaryMessage, timeout: number) => {
      signalled ||= message.nodeWebserver === 'signal';
      stopped = true;
      unwatch();

      return stopSets(message, timeout);
    },
    getPlan: () => running?.plan,
  };
};

export default createFrontsManager;
