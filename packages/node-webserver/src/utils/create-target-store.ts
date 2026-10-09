import { existsSync, readFileSync } from 'fs';
import { rm, writeFile } from 'fs/promises';
import createProxyTarget from './create-proxy-target';
import retireAgent from './retire-agent';
import getDate from './getDate';
import logger from './logger';
import type { ProxyTarget, TargetStore } from '../types';

interface StoreOptions {
  /** the file the target is kept in between restarts */
  persistPath?: string;
  secure?: boolean;
  ca?: string;
}

interface StoredTarget {
  target: string;
  setAt: number;
  expiresAt?: number;
}

const isStoredTarget = (value: unknown): value is StoredTarget =>
  typeof value === 'object' && value !== null && 'target' in value && typeof value.target === 'string' && 'setAt' in value && typeof value.setAt === 'number';

const isExpired = ({ expiresAt }: { expiresAt?: number }) => expiresAt !== undefined && expiresAt <= Date.now();

/** the target a proxy server had before a restart, unless it expired since */
const restore = ({ persistPath, secure, ca }: StoreOptions): ProxyTarget | undefined => {
  if (!persistPath || !existsSync(persistPath)) return undefined;

  try {
    const stored: unknown = JSON.parse(readFileSync(persistPath, 'utf8'));
    if (!isStoredTarget(stored) || isExpired(stored)) return undefined;

    return { ...createProxyTarget(new URL(stored.target), { secure, ca }, stored.expiresAt), setAt: stored.setAt };
  } catch (error) {
    logger.warning(`[${getDate()}] The target kept in ${persistPath} cannot be read, it is left unset:`, error);
    return undefined;
  }
};

/**
 * The target of a proxy server that changes while the server runs: requests read it as it is when they start, so the ones in flight finish on the target they
 * started on, and the connections to an old target close once they are idle.
 */
const createTargetStore = (options: StoreOptions): TargetStore => {
  const { persistPath, secure, ca } = options;
  let current = restore(options);
  // one write after the other, so that the file ends with the last target
  let saving = Promise.resolve();

  const save = () => {
    if (!persistPath) return;

    const stored: StoredTarget | undefined = current && { target: current.url.href, setAt: current.setAt, expiresAt: current.expiresAt };
    saving = saving
      .then(() => (stored ? writeFile(persistPath, JSON.stringify(stored), 'utf8') : rm(persistPath, { force: true })))
      .catch((error) => logger.error(`[${getDate()}] The target cannot be kept in ${persistPath}:`, error));
  };

  const replace = (next: ProxyTarget | undefined) => {
    if (current && current.agent !== next?.agent) retireAgent(current.agent);
    current = next;
  };

  return {
    get: () => {
      if (current && isExpired(current)) replace(undefined);

      return current;
    },
    set: (url, expiresAt) => {
      // the same target again, as a heartbeat does it, keeps its connections
      const next = current?.url.href === url.href ? { ...current, setAt: Date.now(), expiresAt } : createProxyTarget(url, { secure, ca }, expiresAt);
      replace(next);
      save();

      return next;
    },
    unset: () => {
      replace(undefined);
      save();
    },
    saved: () => saving,
  };
};

export default createTargetStore;
