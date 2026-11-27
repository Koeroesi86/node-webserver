import type { ConfigurationProblem, ServerConfig } from '../types';

const SINGLE_FRONT = 'works with one front process only for now: set frontProcesses to 1';

/** what a server has that every front would do on its own: start the application */
const findFrontProblems = (instance: ServerConfig, server: string): ConfigurationProblem[] =>
  instance?.type === 'child' ? [{ severity: 'error', server, setting: 'type', message: `a child server ${SINGLE_FRONT}` }] : [];

export default findFrontProblems;
