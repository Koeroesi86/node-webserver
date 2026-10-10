import path from 'path';
import { uncachedProbe } from './createProbe';
import type { Probe } from './createProbe';
import { Stats } from 'fs';

async function resolvePath(rootPath: string, pathFragments: string[], indexFiles: string[], probe: Probe = uncachedProbe) {
  const currentPathFragments = pathFragments.slice();
  let indexPath = path.join(rootPath, ...currentPathFragments);
  let isWorker = false;
  let pathExists = false;
  let stats: Stats | undefined;

  for (let i = currentPathFragments.length; i >= 0 && !pathExists; i--) {
    if (pathExists) continue;
    currentPathFragments.splice(i);
    const currentPath = path.join(rootPath, ...currentPathFragments);
    pathExists = await probe.exists(currentPath);
    if (!pathExists) continue;
    stats = await probe.stat(currentPath);
    // gone since it was found
    if (stats === undefined) {
      pathExists = false;
      continue;
    }

    if (stats.isDirectory()) {
      // index fallback
      let checkIndexFilePath: string = '';
      for (let indexFile of indexFiles) {
        if (checkIndexFilePath) {
          continue;
        }

        const current = path.join(currentPath, indexFile);
        if (await probe.exists(current)) {
          checkIndexFilePath = indexFile;
        }
      }

      // a directory without an index worker is served by the static worker, which also answers with the 404
      if (checkIndexFilePath) {
        isWorker = true;
        indexPath = path.join(currentPath, checkIndexFilePath);
      }
    } else if (stats.isFile() && indexFiles.includes(currentPathFragments[currentPathFragments.length - 1])) {
      isWorker = true;
    }

    if (isWorker) {
      break;
    }
  }

  // the walk stops at the first path that exists, which is the requested one only when nothing had to be left off
  const targetExists = pathExists && currentPathFragments.length === pathFragments.length;

  return { indexPath, isWorker, pathExists, targetExists, stats };
}

export default resolvePath;
