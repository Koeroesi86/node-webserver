import type { ConfigurationProblem, ServerConfig } from '../types';

/** the redirect to https and the HSTS header belong to an https server, on an http one they would do nothing */
const findRedirectProblems = ({ protocol, redirectHttp, hsts }: ServerConfig, server: string): ConfigurationProblem[] =>
  [
    { setting: 'redirectHttp', value: redirectHttp },
    { setting: 'hsts', value: hsts },
  ]
    .filter(({ value }) => value && protocol !== 'https')
    .map(({ setting }) => ({ severity: 'error' as const, server, setting, message: 'is for an https server' }));

export default findRedirectProblems;
