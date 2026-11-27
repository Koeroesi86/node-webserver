import { createTargetFile } from '../proxy';
import type { FrontService, Logger, PrimaryMessage, TargetChange, TargetFile } from '../types';

interface Member {
  send: (message: PrimaryMessage) => void;
  /** whether it said it listens, and was told all targets */
  listens?: boolean;
  /** of the targets of its servers, set once it serves */
  keys?: string[];
}

/**
 * The registered targets of the dynamic `proxy` servers, as the primary keeps them for all its fronts: a front tells it what was registered with it, and it tells every front,
 * the ones that start later too, and writes the file of the target. A change that is older than what it has is not taken.
 */
const createTargetRegistry = (logger: Logger): FrontService => {
  const members = new Set<Member>();
  const targets = new Map<string, TargetChange>();
  const files = new Map<string, TargetFile>();

  const save = (change: TargetChange) => {
    const { persistPath } = change;
    if (!persistPath) return;

    const file = files.get(persistPath) ?? createTargetFile(persistPath, logger);
    files.set(persistPath, file);
    file.save(change);
  };

  /** forgets the targets of servers no front has any more, so that one that is added again starts without. Only once every front said which it has. */
  const prune = () => {
    const held = Array.from(members, ({ keys }) => keys);
    if (held.includes(undefined)) return;

    const kept = new Set(held.flat());
    Array.from(targets.keys())
      .filter((key) => !kept.has(key))
      .forEach((key) => targets.delete(key));
  };

  const take = (change: TargetChange) => {
    const known = targets.get(change.key);
    const current = known && known.setAt > change.setAt ? known : change;
    targets.set(change.key, current);
    if (current === change) save(change);
    // also when it was not taken, as the front that sent it waits to hear what counts
    // one that does not listen yet is told all of them when it does, and takes the first it hears as all there are
    Array.from(members)
      .filter(({ listens }) => listens)
      .forEach(({ send }) => send({ nodeWebserver: 'targets', changes: [current] }));
  };

  return {
    join: (send) => {
      const member: Member = { send };
      members.add(member);

      return {
        hello: () => {
          member.listens = true;
          send({ nodeWebserver: 'targets', changes: Array.from(targets.values()) });
        },
        receive: (message) => message.nodeWebserver === 'target' && take(message.change),
        serves: ({ targets: keys }) => {
          member.keys = keys;
          prune();
        },
        leave: () => void members.delete(member),
      };
    },
  };
};

export default createTargetRegistry;
