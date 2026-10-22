import type { ConfigurationProblem, ServerConfig } from '../types';
import findAcmeProblems from './find-acme-problems';
import findCertificateProblems from './find-certificate-problems';
import findChildProblems from './find-child-problems';
import findLambdaProblems from './find-lambda-problems';
import findMissingPaths from './find-missing-paths';
import findRedirectProblems from './find-redirect-problems';
import findRuleProblems from './find-rule-problems';
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

/** what the schema cannot say about a server: files that are not there, certificates, ACME settings, patterns that are not regular expressions and settings that conflict */
const findServerProblems = (instance: ServerConfig, server: string): ConfigurationProblem[] => [
  ...attempt(() =>
    findMissingPaths(server, [
      // the key and certificate of an acme server are made when it starts, and renewed after
      { setting: 'key', path: instance.acme ? undefined : instance.key, kind: 'file' },
      { setting: 'cert', path: instance.acme ? undefined : instance.cert, kind: 'file' },
      { setting: 'ca', path: instance.ca, kind: 'file' },
    ])
  ),
  ...attempt(() => (instance.acme ? [] : findCertificateProblems(instance, server))),
  ...attempt(() => findAcmeProblems(instance, server)),
  ...attempt(() => findRedirectProblems(instance, server)),
  ...attempt(() => findRuleProblems(instance, server)),
  ...attempt(() => (instance.type ? (byType[instance.type]?.(instance, server) ?? []) : [])),
];

export default findServerProblems;
