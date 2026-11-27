import type { FrontMessage, SharedTargets, TargetChange } from '../types';

interface Listener {
  key: string;
  listener: (change: TargetChange) => void;
}

interface Waiting {
  change: TargetChange;
  done: () => void;
}

/** The registered targets as a front has them: what the primary told it, and what was registered with it, which it tells the primary. */
const createFrontTargets = (send: (message: FrontMessage) => unknown) => {
  const known = new Map<string, TargetChange>();
  const listeners = new Set<Listener>();
  let waiting: Waiting[] = [];

  /** whether the primary answered a change that was sent, with it or with a newer one */
  const settle = (answer: TargetChange) => {
    const answered = waiting.filter(({ change }) => change.key === answer.key && answer.setAt >= change.setAt);
    waiting = waiting.filter((entry) => !answered.includes(entry));
    answered.forEach(({ done }) => done());
  };

  const take = (change: TargetChange) => {
    settle(change);
    // one that is older than what was registered here meanwhile
    if (change.setAt < (known.get(change.key)?.setAt ?? 0)) return;

    known.set(change.key, change);
    listeners.forEach(({ key, listener }) => key === change.key && listener(change));
  };

  const shared: SharedTargets = {
    get: (key) => known.get(key),
    publish: (change) =>
      new Promise<void>((done) => {
        known.set(change.key, change);
        waiting.push({ change, done });
        send({ nodeWebserver: 'target', change });
      }),
    subscribe: (key, listener) => {
      const entry = { key, listener };
      listeners.add(entry);

      return () => void listeners.delete(entry);
    },
  };

  return { ...shared, receive: (changes: TargetChange[]) => changes.forEach(take) };
};

export default createFrontTargets;
