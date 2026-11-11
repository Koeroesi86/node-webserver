import path from 'path';
import type { ConfigurationProblem, ServerConfig } from '../types';
import findMissingPaths from './find-missing-paths';
import findPatternProblems from './find-pattern-problems';

/** the root, the other folders and files of a worker server, and the patterns of its routes */
const findWorkerProblems = ({ options }: ServerConfig, server: string): ConfigurationProblem[] => {
  if (!options) return [];

  const { root, cwd, staticWorker, routes = [] } = options;

  return [
    ...findMissingPaths(server, [
      { setting: 'options.root', path: root, kind: 'folder' },
      { setting: 'options.cwd', path: cwd, kind: 'folder' },
      { setting: 'options.staticWorker', path: staticWorker, kind: 'file' },
      ...routes.map(({ worker }, position) => ({ setting: `options.routes[${position}].worker`, path: path.resolve(root, worker), kind: 'file' as const })),
    ]),
    ...findPatternProblems(
      server,
      'options.routes',
      routes.map((route) => ('pattern' in route ? route : {}))
    ),
  ];
};

export default findWorkerProblems;
