import path from 'path';
import findIndexFiles from './find-index-files';
import type { ServerConfig } from '../types';

/**
 * The paths a worker or a lambda server is given in the configuration: the root of a worker server, the files of its routes, the index files under the root and its own static worker,
 * the files of a lambda server and of its routes.
 * They run in other processes, so they are not in the require graph of the server module. They are kept as configured (resolved, not followed through links), as a link that points elsewhere is the change.
 */
const getEntryFiles = ({ type, options, lambdaOptions }: ServerConfig): string[] => {
  if (type === 'worker' && options) {
    const root = path.resolve(options.root);
    const routed = (options.routes ?? []).map(({ worker }) => path.resolve(root, worker));
    const indexed = findIndexFiles(root, options.index ?? []);

    return [root, ...routed, ...indexed, ...(options.staticWorker ? [path.resolve(options.staticWorker)] : [])];
  }

  if (type === 'lambda' && lambdaOptions) {
    return [lambdaOptions.lambda, ...(lambdaOptions.routes ?? []).map(({ lambda }) => lambda)]
      .filter((file): file is string => !!file)
      .map((file) => path.resolve(file));
  }

  return [];
};

export default getEntryFiles;
