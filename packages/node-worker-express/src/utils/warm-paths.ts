import type { Probe } from './createProbe';
import resolvePath from './resolvePath';

interface WarmPathsParams {
  paths: string[];
  rootPath: string;
  index: string[];
  probe: Probe;
  /** how many workers are kept for the worker file of a path */
  countFor: (indexPath: string) => number;
  keepWarm: (indexPath: string, count: number) => void;
}

/** The worker files are found the way a request finds them, a path that is served by the static worker has nothing to keep warm. */
const warmPaths = ({ paths, rootPath, index, probe, countFor, keepWarm }: WarmPathsParams) =>
  Promise.all(
    paths.map((warmPath) =>
      resolvePath(rootPath, warmPath.split('/').filter(Boolean), index, probe)
        .then(({ indexPath, isWorker }) => {
          if (isWorker) keepWarm(indexPath, countFor(indexPath));
        })
        // warming is an optimization, a path that cannot be looked up is started by its first request
        .catch(() => undefined)
    )
  );

export default warmPaths;
