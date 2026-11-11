import type { ConfigurationProblem, ServerConfig } from '../types';
import findMissingPaths from './find-missing-paths';
import findPatternProblems from './find-pattern-problems';

/** a lambda server answers with something only when it has a lambda or routes to some, and the files of them have to be there */
const findLambdaProblems = ({ lambdaOptions }: ServerConfig, server: string): ConfigurationProblem[] => {
  if (!lambdaOptions) return [];

  const { lambda, routes = [] } = lambdaOptions;
  const unreachable: ConfigurationProblem[] =
    lambda || routes.length ? [] : [{ severity: 'error', server, setting: 'lambdaOptions', message: 'needs a lambda, or routes to lambdas' }];

  return [
    ...unreachable,
    ...findMissingPaths(server, [
      { setting: 'lambdaOptions.lambda', path: lambda, kind: 'file' },
      ...routes.map((route, position) => ({ setting: `lambdaOptions.routes[${position}].lambda`, path: route.lambda, kind: 'file' as const })),
    ]),
    ...findPatternProblems(
      server,
      'lambdaOptions.routes',
      routes.map((route) => ('pattern' in route ? route : {}))
    ),
  ];
};

export default findLambdaProblems;
