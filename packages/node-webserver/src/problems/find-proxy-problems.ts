import type { ConfigurationProblem, ServerConfig } from '../types';
import findMissingPaths from './find-missing-paths';

/** a proxy server has a fixed target that is a URL, or a dynamic one with a token, and not both */
const findProxyProblems = ({ proxyOptions }: ServerConfig, server: string): ConfigurationProblem[] => {
  if (!proxyOptions) return [];

  const { target, dynamic, ca } = proxyOptions;
  const token = dynamic?.token ?? (dynamic?.tokenEnv ? process.env[dynamic.tokenEnv] : undefined);
  const problems: ConfigurationProblem[] = [
    ...(Boolean(target) === Boolean(dynamic)
      ? [{ severity: 'error' as const, server, setting: 'proxyOptions', message: 'needs either a target or a dynamic one' }]
      : []),
    ...(target && !URL.canParse(target) ? [{ severity: 'error' as const, server, setting: 'proxyOptions.target', message: `is not a URL: ${target}` }] : []),
    ...(dynamic && !token
      ? [{ severity: 'error' as const, server, setting: 'proxyOptions.dynamic', message: 'needs a token, or the environment variable of it (tokenEnv) set' }]
      : []),
  ];

  return [...problems, ...findMissingPaths(server, [{ setting: 'proxyOptions.ca', path: ca, kind: 'file' }])];
};

export default findProxyProblems;
