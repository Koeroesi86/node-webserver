import findMissingPaths from './find-missing-paths';
import type { ConfigurationProblem, ServerConfig } from '../types';

/** a page that is not a file, and a status that is not an error: the schema reports a status that is no number */
const findErrorPageProblems = ({ errorPages = {} }: Pick<ServerConfig, 'errorPages'>, server: string): ConfigurationProblem[] => [
  ...findMissingPaths(
    server,
    Object.entries(errorPages).map(([status, path]) => ({ setting: `errorPages.${status}`, path, kind: 'file' as const }))
  ),
  ...Object.keys(errorPages)
    .filter((status) => !/^[45]\d\d$/.test(status))
    .map((status) => ({ severity: 'error' as const, server, setting: `errorPages.${status}`, message: 'has to be a status code from 400 to 599' })),
];

export default findErrorPageProblems;
