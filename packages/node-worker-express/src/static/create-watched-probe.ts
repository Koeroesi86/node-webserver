import fs from 'fs';
import path from 'path';
import readDirectoryNames from './read-directory-names';
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
    maxDirectories = 256,
    maxEntries = 5000,
    maxTotalEntries = 20000,
    cooldown = 1000,
    oversizedCooldown = 60000,
    maxAge = 1000,
  }: {
    /** how many directories are listed and watched at the same time, no more are listed until a listing has expired */
    maxDirectories?: number;
    /** a directory with more entries keeps using the probe below */
    maxEntries?: number;
    /** how many names all listings hold together, which bounds their memory, a directory that would not fit is not listed */
    maxTotalEntries?: number;
    /** how long a directory that changed, or could not be watched, is left alone before it is listed again */
    cooldown?: number;
    /** the same for a directory that is too large to list, which is costly to find out again */
    oversizedCooldown?: number;
    /** how long a listing is kept at the longest, whatever the watcher reported */
    maxAge?: number;
  } = {}
): Probe & { close: () => void; stats: () => { directories: number; listings: number; entries: number } } {
  // a watcher is there from the moment the directory is read, a listing once the read is done
  const watchers = new Map<string, fs.FSWatcher>();
  const listings = new Map<string, { names: Set<string>; expires: number }>();
  const changed = new TtlCache<true>(cooldown, maxDirectories);
  const oversized = new TtlCache<true>(oversizedCooldown, maxDirectories);
  const missed = new TtlCache<true>(cooldown, maxDirectories * 4);
  const entryLimit = Math.min(maxEntries, maxTotalEntries);
  let totalEntries = 0;
  let closed = false;

  // 0 directories switches the listings off, the probe below is then all there is
  if (maxDirectories <= 0) {
    return { ...base, stats: () => ({ directories: 0, listings: 0, entries: 0 }), close: () => undefined };
  }

  const drop = (directory: string) => {
    totalEntries -= listings.get(directory)?.names.size ?? 0;
    watchers.get(directory)?.close();
    watchers.delete(directory);
    listings.delete(directory);
  };

  const dropWatched = (directory: string, watcher: fs.FSWatcher) => {
    if (watchers.get(directory) !== watcher) return;
    drop(directory);
    changed.set(directory, true);
  };

  // listings are added with the same age, so the oldest is the first one to expire
  const dropExpired = () => {
    const [oldest, listing] = listings.entries().next().value ?? [];
    if (oldest === undefined || listing.expires > Date.now()) return;

    drop(oldest);
    dropExpired();
  };

  const keep = (directory: string, watcher: fs.FSWatcher, names: Set<string> | undefined) => {
    if (watchers.get(directory) !== watcher) return;
    if (names === undefined) {
      drop(directory);
      oversized.set(directory, true);
      return;
    }

    dropExpired();
    if (totalEntries + names.size > maxTotalEntries) {
      // the listings that are there stay, one that is read again and again would cost more than it saves
      drop(directory);
      changed.set(directory, true);
      return;
    }
    listings.set(directory, { names, expires: Date.now() + maxAge });
    totalEntries += names.size;
  };

  const list = (directory: string) => {
    if (closed || watchers.has(directory) || changed.get(directory) || oversized.get(directory)) return;
    // a directory is listed when a second path in it is missing, a scan that asks for one path per directory would only fill the watchers
    if (missed.get(directory) === undefined) {
      missed.set(directory, true);
      return;
    }

    if (watchers.size >= maxDirectories) dropExpired();
    if (watchers.size >= maxDirectories) return;

    // watching starts before reading, so that a change during the read drops the watcher and the stale listing is not kept
    const watcher = watchDirectory(directory);
    if (watcher === undefined) {
      changed.set(directory, true);
      return;
    }

    watchers.set(directory, watcher);
    watcher.on('change', () => dropWatched(directory, watcher));
    watcher.on('error', () => dropWatched(directory, watcher));
    readDirectoryNames(directory, entryLimit, normalize)
      .then((names) => keep(directory, watcher, names))
      .catch(() => dropWatched(directory, watcher));
  };

  const isMissingInListing = (fileName: string) => {
    const directory = path.dirname(fileName);
    const listing = listings.get(directory);
    if (listing === undefined) return false;
    // a watcher can report late (macOS), so a listing is not trusted for longer than the probe below would trust its own answer
    if (listing.expires <= Date.now()) {
      drop(directory);
      return false;
    }

    return !listing.names.has(normalize(path.basename(fileName)));
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
    stats: () => ({ directories: watchers.size, listings: listings.size, entries: totalEntries }),
    close: () => {
      closed = true;
      totalEntries = 0;
      watchers.forEach((watcher) => watcher.close());
      watchers.clear();
      listings.clear();
    },
  };
}
