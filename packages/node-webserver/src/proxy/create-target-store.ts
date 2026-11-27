import { existsSync, readFileSync } from 'fs';
import createProxyTarget from './create-proxy-target';
import createTargetFile from './create-target-file';
import retireAgent from './retire-agent';
import { getDate } from '../utils';
import type { Logger, ProxyTarget, SharedTargets, TargetState, TargetStore } from '../types';

interface StoreOptions {
  /** the file the target is kept in between restarts */
  persistPath?: string;
  secure?: boolean;
  ca?: string;
  logger: Logger;
  /** in a front: the target as all fronts have it, which the primary keeps in the file. Without it the store keeps the file itself. */
  shared?: { targets: SharedTargets; key: string };
}

type StoredTarget = TargetState & { target: string };

const isStoredTarget = (value: unknown): value is StoredTarget =>
  typeof value === 'object' && value !== null && 'target' in value && typeof value.target === 'string' && 'setAt' in value && typeof value.setAt === 'number';

const isExpired = ({ expiresAt }: { expiresAt?: number }) => expiresAt !== undefined && expiresAt <= Date.now();

/** the target of a state, with connections of its own, unless it was removed or expired */
const fromState = ({ target, setAt, expiresAt }: TargetState, { secure, ca }: StoreOptions): ProxyTarget | undefined =>
  target === undefined || isExpired({ expiresAt }) ? undefined : { ...createProxyTarget(new URL(target), { secure, ca }, expiresAt), setAt };

const readStored = (persistPath: string, options: StoreOptions): ProxyTarget | undefined => {
  const stored: unknown = JSON.parse(readFileSync(persistPath, 'utf8'));

  return isStoredTarget(stored) ? fromState(stored, options) : undefined;
};

/** the target a proxy server had before a restart, unless it expired since */
const restore = (options: StoreOptions): ProxyTarget | undefined => {
  const { persistPath, logger } = options;
  if (!persistPath || !existsSync(persistPath)) return undefined;

  try {
    return readStored(persistPath, options);
  } catch (error) {
    logger.warning(`[${getDate()}] The target kept in ${persistPath} cannot be read, it is left unset:`, error);
    return undefined;
  }
};

/** the target the store starts with: what all fronts have, else the one of the server it replaces, else the one in the file */
const findFirst = (options: StoreOptions, seed?: ProxyTarget) => {
  const known = options.shared?.targets.get(options.shared.key);
  if (known) return fromState(known, options);

  return seed ? fromState({ target: seed.url.href, setAt: seed.setAt, expiresAt: seed.expiresAt }, options) : restore(options);
};

/**
 * The target of a proxy server that changes while the server runs: requests read it as it is when they start, so the ones in flight finish on the target they
 * started on, and the connections to an old target close once they are idle. `seed` is the target of the server this one replaces, which wins over the file.
 * In a front of a server it is the same in all of them (`shared`).
 */
const createTargetStore = (options: StoreOptions, seed?: ProxyTarget): TargetStore => {
  const { persistPath, secure, ca, logger, shared } = options;
  let current = findFirst(options, seed);
  const file = persistPath && !shared ? createTargetFile(persistPath, logger) : undefined;
  let published = Promise.resolve();

  const save = () => {
    const state: TargetState = current ? { target: current.url.href, setAt: current.setAt, expiresAt: current.expiresAt } : { setAt: Date.now() };
    if (shared) published = shared.targets.publish({ ...state, key: shared.key, persistPath });
    file?.save(state);
  };

  const replace = (next: ProxyTarget | undefined) => {
    if (current && current.agent !== next?.agent) retireAgent(current.agent);
    current = next;
  };

  /** the same target again, as a heartbeat does it, keeps its connections */
  const withTarget = (url: URL, expiresAt?: number, setAt = Date.now()): ProxyTarget =>
    current?.url.href === url.href ? { ...current, setAt, expiresAt } : { ...createProxyTarget(url, { secure, ca }, expiresAt), setAt };

  const unsubscribe = shared?.targets.subscribe(shared.key, ({ target, setAt, expiresAt }) =>
    replace(target === undefined || isExpired({ expiresAt }) ? undefined : withTarget(new URL(target), expiresAt, setAt))
  );

  // a file named only now gets the target that was handed over. A front without one has nothing to tell the others.
  if (seed && (current || !shared)) save();

  return {
    get: () => {
      if (current && isExpired(current)) replace(undefined);

      return current;
    },
    set: (url, expiresAt) => {
      const next = withTarget(url, expiresAt);
      replace(next);
      save();

      return next;
    },
    unset: () => {
      replace(undefined);
      save();
    },
    saved: () => file?.saved() ?? Promise.resolve(),
    published: () => published,
    close: () => {
      unsubscribe?.();
      if (current) retireAgent(current.agent);
    },
  };
};

export default createTargetStore;
