import path from 'path';
import { uncachedProbe } from './createProbe';
import type { Probe } from './createProbe';
import { Stats } from 'fs';

/** the stats of a path that is there, a path that is gone since `exists` said so counts as missing */
const statExisting = async (probe: Probe, currentPath: string) => ((await probe.exists(currentPath)) ? probe.stat(currentPath) : undefined);

const findIndexFile = async (directory: string, indexFiles: string[], probe: Probe) => {
  for (const indexFile of indexFiles) {
    if (await probe.exists(path.join(directory, indexFile))) return indexFile;
  }

  return undefined;
};

async function resolvePath(rootPath: string, pathFragments: string[], indexFiles: string[], probe: Probe = uncachedProbe) {
  const currentPathFragments = pathFragments.slice();
  let indexPath = path.join(rootPath, ...currentPathFragments);
  let isWorker = false;
  let pathExists = false;
  let stats: Stats | undefined;

  for (let i = currentPathFragments.length; i >= 0 && !pathExists; i--) {
    currentPathFragments.splice(i);
    const currentPath = path.join(rootPath, ...currentPathFragments);
    stats = await statExisting(probe, currentPath);
    pathExists = stats !== undefined;
    if (!stats) continue;

    const indexFile = stats.isDirectory() ? await findIndexFile(currentPath, indexFiles, probe) : undefined;
    // a directory without an index worker is served by the static worker, which also answers with the 404
    if (indexFile) {
      isWorker = true;
      indexPath = path.join(currentPath, indexFile);
    } else if (stats.isFile() && indexFiles.includes(currentPathFragments[currentPathFragments.length - 1])) {
      isWorker = true;
    }
  }

  // the walk stops at the first path that exists, which is the requested one only when nothing had to be left off
  const targetExists = pathExists && currentPathFragments.length === pathFragments.length;

  return { indexPath, isWorker, pathExists, targetExists, stats };
}

export default resolvePath;
