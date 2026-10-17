import type { ConfigurationProblem } from '../types';

/** one line for each problem, with the server and the setting it is about */
const formatProblems = (problems: ConfigurationProblem[]) =>
  problems.map(({ severity, server, setting, message }) => `${severity}: ${[server, setting].filter(Boolean).join(' ')} ${message}`).join('\n');

export default formatProblems;
