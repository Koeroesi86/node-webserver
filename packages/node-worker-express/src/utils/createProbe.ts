import fs from 'fs/promises';
import fileExists from './fileExists';
import TtlCache from './ttlCache';
import type { Stats } from 'fs';

/** what resolving a path asks the file system */
export interface Probe {
  /** whether the path can be read */
  exists: (fileName: string) => Promise<boolean>;
  /** the stats of the path, `undefined` when it cannot be read */
  stat: (fileName: string) => Promise<Stats | undefined>;
}

export const uncachedProbe: Probe = {
  exists: fileExists,
  stat: (fileName) => fs.stat(fileName).catch(() => undefined),
};

/**
 * A probe that remembers the answers for a short time, also the negative ones, and shares one question between requests that ask it at the same time.
 * Resolving a path asks about every directory above it, so requests for many different paths below the same directories only cost the question about the new part.
 */
export default function createProbe(ttl = 1000, maxSize = 10000): Probe {
  const exists = new TtlCache<Promise<boolean>>(ttl, maxSize);
  const stats = new TtlCache<Promise<Stats | undefined>>(ttl, maxSize);

  const remember = <V>(cache: TtlCache<Promise<V>>, ask: (fileName: string) => Promise<V>) => {
    return (fileName: string) => {
      const known = cache.get(fileName);
      if (known !== undefined) return known;

      const answer = ask(fileName);
      cache.set(fileName, answer);
      return answer;
    };
  };

  return { exists: remember(exists, uncachedProbe.exists), stat: remember(stats, uncachedProbe.stat) };
}
