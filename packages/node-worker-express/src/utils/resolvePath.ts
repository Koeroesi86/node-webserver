import path from 'path';
import { uncachedProbe } from './createProbe';
import type { Probe } from './createProbe';
import { Stats } from 'fs';

/** the stats of a path that is there, a path that is gone since `exists` said so counts as missing */
const statExisting = async (probe: Probe, currentPath: string) => ((await probe.exists(currentPath)) ? probe.stat(currentPath) : undefined);

const findIndexFile = async (directory: string, indexFiles: string[], probe: Probe): Promise<string | undefined> => {
  const [indexFile, ...rest] = indexFiles;
  if (indexFile === undefined) return undefined;
  if (await probe.exists(path.join(directory, indexFile))) return indexFile;

  return findIndexFile(directory, rest, probe);
};

async function resolvePath(rootPath: string, pathFragments: string[], indexFiles: string[], probe: Probe = uncachedProbe) {
  const currentPathFragments = pathFragments.slice();
  const requestedPath = path.join(rootPath, ...currentPathFragments);
  let stats: Stats | undefined;

  for (let i = currentPathFragments.length; i >= 0 && !stats; i--) {
    currentPathFragments.splice(i);
    stats = await statExisting(probe, path.join(rootPath, ...currentPathFragments));
  }

  const currentPath = path.join(rootPath, ...currentPathFragments);
  const indexFile = stats?.isDirectory() ? await findIndexFile(currentPath, indexFiles, probe) : undefined;
  // a directory without an index worker is served by the static worker, which also answers with the 404
  const isWorker = Boolean(indexFile) || (stats?.isFile() === true && indexFiles.includes(currentPathFragments[currentPathFragments.length - 1]));
  const indexPath = indexFile ? path.join(currentPath, indexFile) : requestedPath;
  const pathExists = stats !== undefined;

  // the walk stops at the first path that exists, which is the requested one only when nothing had to be left off
  const targetExists = pathExists && currentPathFragments.length === pathFragments.length;

  return { indexPath, isWorker, pathExists, targetExists, stats };
}

export default resolvePath;
