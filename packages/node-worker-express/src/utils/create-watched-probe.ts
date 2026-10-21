import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import TtlCache from './ttl-cache';
import type { Probe } from './create-probe';

// the names are compared without case and in one unicode form, so that a listing never says "missing" about a name that a case insensitive file system finds
const normalize = (name: string) => name.normalize('NFC').toLowerCase();

const watchDirectory = (directory: string) => {
  try {
    return fs.watch(directory, { persistent: false });
  } catch {
    // the directory is not there, or the system is out of watchers
    return undefined;
  }
};

/**
 * A probe that answers "missing" from the listing of the directory when it has one, and asks the probe below for everything else.
 * A directory is listed after the probe below found a path in it missing, and the listing is kept as long as the watcher of the directory reports nothing:
 * a scan of paths that were never asked for before then costs a lookup in memory instead of a file system call each.
 * Only the answer "missing" comes from a listing, a name that is listed is asked from the probe below, which also knows about permissions.
 */
export default function createWatchedProbe(
  base: Probe,
  {
    maxDirectories = 1000,
    maxEntries = 5000,
    cooldown = 1000,
    oversizedCooldown = 60000,
  }: {
    /** how many directories are listed and watched at the same time, the oldest listing goes first */
    maxDirectories?: number;
    /** a directory with more entries keeps using the probe below */
    maxEntries?: number;
    /** how long a directory that changed, or could not be watched, is left alone before it is listed again */
    cooldown?: number;
    /** the same for a directory that is too large to list, which is costly to find out again */
    oversizedCooldown?: number;
  } = {}
): Probe & { close: () => void } {
  // a watcher is there from the moment the directory is read, a listing once the read is done
  const watchers = new Map<string, fs.FSWatcher>();
  const listings = new Map<string, Set<string>>();
  const changed = new TtlCache<true>(cooldown, maxDirectories * 10);
  let closed = false;
  const oversized = new TtlCache<true>(oversizedCooldown, maxDirectories * 10);

  const drop = (directory: string) => {
    watchers.get(directory)?.close();
    watchers.delete(directory);
    listings.delete(directory);
  };

  const dropWatched = (directory: string, watcher: fs.FSWatcher) => {
    if (watchers.get(directory) !== watcher) return;
    drop(directory);
    changed.set(directory, true);
  };

  const keep = (directory: string, watcher: fs.FSWatcher, names: string[]) => {
    if (watchers.get(directory) !== watcher) return;
    if (names.length <= maxEntries) {
      listings.set(directory, new Set(names.map(normalize)));
      return;
    }
    drop(directory);
    oversized.set(directory, true);
  };

  const makeRoom = () => {
    const oldest = watchers.keys().next().value;
    if (watchers.size >= maxDirectories && oldest !== undefined) drop(oldest);
  };

  const list = (directory: string) => {
    if (closed || watchers.has(directory) || changed.get(directory) || oversized.get(directory)) return;

    makeRoom();
    // watching starts before reading, so that a change during the read drops the watcher and the stale listing is not kept
    const watcher = watchDirectory(directory);
    if (watcher === undefined) {
      changed.set(directory, true);
      return;
    }

    watchers.set(directory, watcher);
    watcher.on('change', () => dropWatched(directory, watcher));
    watcher.on('error', () => dropWatched(directory, watcher));
    fsPromises
      .readdir(directory)
      .then((names) => keep(directory, watcher, names))
      .catch(() => dropWatched(directory, watcher));
  };

  const isMissingInListing = (fileName: string) => {
    const names = listings.get(path.dirname(fileName));
    return names !== undefined && !names.has(normalize(path.basename(fileName)));
  };

  const answer = <V>(ask: (fileName: string) => Promise<V>, missing: V) => {
    return async (fileName: string) => {
      if (isMissingInListing(fileName)) return missing;

      const result = await ask(fileName);
      if (!result) list(path.dirname(fileName));
      return result;
    };
  };

  return {
    exists: answer(base.exists, false),
    stat: answer(base.stat, undefined),
    close: () => {
      closed = true;
      watchers.forEach((watcher) => watcher.close());
      watchers.clear();
      listings.clear();
    },
  };
}
