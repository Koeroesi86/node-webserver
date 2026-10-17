import type { ConfigurationProblem, ServerConfig } from '../types';
import findCertificateProblems from './find-certificate-problems';
import findChildProblems from './find-child-problems';
import findLambdaProblems from './find-lambda-problems';
import findMissingPaths from './find-missing-paths';
import findProxyProblems from './find-proxy-problems';
import findWorkerProblems from './find-worker-problems';

const byType: Partial<Record<NonNullable<ServerConfig['type']>, (instance: ServerConfig, server: string) => ConfigurationProblem[]>> = {
  worker: findWorkerProblems,
  lambda: findLambdaProblems,
  proxy: findProxyProblems,
  child: findChildProblems,
};

/** a finder that fails on a setting of the wrong type has nothing to add, the schema reports that setting */
const attempt = (find: () => ConfigurationProblem[]) => {
  try {
    return find();
  } catch {
    return [];
  }
};

/** what the schema cannot say about a server: files that are not there, certificates, patterns that are not regular expressions and settings that conflict */
const findServerProblems = (instance: ServerConfig, server: string): ConfigurationProblem[] => [
  ...attempt(() =>
    findMissingPaths(server, [
      { setting: 'key', path: instance.key, kind: 'file' },
      { setting: 'cert', path: instance.cert, kind: 'file' },
      { setting: 'ca', path: instance.ca, kind: 'file' },
    ])
  ),
  ...attempt(() => findCertificateProblems(instance, server)),
  ...attempt(() => (instance.type ? (byType[instance.type]?.(instance, server) ?? []) : [])),
];

export default findServerProblems;
