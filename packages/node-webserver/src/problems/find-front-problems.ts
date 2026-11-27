import type { ConfigurationProblem, ServerConfig } from '../types';

const SINGLE_FRONT = 'works with one front process only for now: set frontProcesses to 1';

/** what a server has that every front would do on its own: start the application or order the certificate */
const findFrontProblems = (instance: ServerConfig, server: string): ConfigurationProblem[] =>
  [
    { setting: 'type', message: `a child server ${SINGLE_FRONT}`, found: instance?.type === 'child' },
    { setting: 'acme', message: SINGLE_FRONT, found: Boolean(instance?.acme) },
  ]
    .filter(({ found }) => found)
    .map(({ setting, message }) => ({ severity: 'error', server, setting, message }));

export default findFrontProblems;
