import path from 'path';
import type { Configuration, LoadedInstance } from '../types';

/** the files a change of which changes the servers: the ones they were loaded from, the ones that do not exist yet, and their certificates */
const getWatchedFiles = (servers: Configuration['servers'], loaded: LoadedInstance[]) => [
  ...servers.filter((source): source is string => typeof source === 'string').map((source) => path.resolve(source)),
  ...loaded.flatMap(({ files }) => files),
  ...loaded.flatMap(({ instance: { key, cert, ca } }) => [key, cert, ca].filter((file): file is string => typeof file === 'string')),
];

export default getWatchedFiles;
